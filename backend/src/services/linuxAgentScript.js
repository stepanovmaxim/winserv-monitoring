const LINUX_AGENT_VERSION = '1.0';

// Bash agent for Ubuntu/Debian (systemd). Reports into the same ingest endpoints
// as the Windows agent, so it lands in the existing tables/UI unchanged.
// Heavy collectors are time-throttled via state files, mirroring the Windows agent.
function generateLinuxScript(serverUrl, regKey) {
  return `#!/usr/bin/env bash
# WinServ Monitoring Linux Agent v${LINUX_AGENT_VERSION}
# Installed by the one-liner from the Deploy page. Runs from a systemd timer.
set -u

AGENT_VERSION="${LINUX_AGENT_VERSION}"
SERVER_URL="${serverUrl}"
REG_KEY="${regKey}"
CONF_DIR="/etc/winserv-agent"
CONF="\$CONF_DIR/config.json"
SELF="/opt/winserv-agent/agent.sh"
LOG="/var/log/winserv-agent.log"

mkdir -p "\$CONF_DIR" 2>/dev/null

log() { echo "\$(date '+%F %T') \$*" >> "\$LOG" 2>/dev/null; }
# Keep the log from growing without bound.
[ -f "\$LOG" ] && [ "\$(stat -c %s "\$LOG" 2>/dev/null || echo 0)" -gt 1000000 ] && tail -n 200 "\$LOG" > "\$LOG.tmp" 2>/dev/null && mv "\$LOG.tmp" "\$LOG" 2>/dev/null

# JSON string escaping for values we interpolate.
esc() { printf '%s' "\$1" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g' | tr -d '\\000-\\037'; }
jget() { sed -n "s/.*\\"\$2\\"[[:space:]]*:[[:space:]]*\\"\\([^\\"]*\\)\\".*/\\1/p" <<< "\$1" | head -1; }
jgetnum() { sed -n "s/.*\\"\$2\\"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p" <<< "\$1" | head -1; }

post() { curl -fsS --max-time 25 -X POST "\$1" -H 'Content-Type: application/json' -d "\$2" 2>>"\$LOG"; }

# --- state (token + throttle timestamps) ---
TOKEN=""
[ -f "\$CONF" ] && TOKEN=\$(jget "\$(cat "\$CONF")" token)
st_get() { [ -f "\$CONF_DIR/\$1" ] && cat "\$CONF_DIR/\$1" 2>/dev/null || echo 0; }
st_set() { echo "\$2" > "\$CONF_DIR/\$1" 2>/dev/null; }
NOW=\$(date +%s)
due() { [ \$(( NOW - \$(st_get "\$1") )) -ge "\$2" ]; }

# --- identity ---
HOST=\$(hostname -f 2>/dev/null || hostname)
IP=\$(ip route get 1.1.1.1 2>/dev/null | awk '{print \$7; exit}')
[ -z "\$IP" ] && IP=\$(hostname -I 2>/dev/null | awk '{print \$1}')
OS_INFO=\$( . /etc/os-release 2>/dev/null && printf '%s' "\$PRETTY_NAME" )
[ -z "\$OS_INFO" ] && OS_INFO="Linux"

# --- CPU: busy % sampled over 1s from /proc/stat ---
cpu_snap() { awk '/^cpu /{idle=\$5+\$6; tot=0; for(i=2;i<=NF;i++) tot+=\$i; print idle" "tot}' /proc/stat; }
S1=\$(cpu_snap); sleep 1; S2=\$(cpu_snap)
I1=\${S1% *}; T1=\${S1#* }; I2=\${S2% *}; T2=\${S2#* }
DI=\$((I2-I1)); DT=\$((T2-T1))
CPU=0
[ "\$DT" -gt 0 ] && CPU=\$(awk -v di="\$DI" -v dt="\$DT" 'BEGIN{printf "%.1f", (1-di/dt)*100}')

# --- memory (MB) ---
MEM_TOTAL=\$(awk '/^MemTotal:/{printf "%.0f", \$2/1024}' /proc/meminfo)
MEM_AVAIL=\$(awk '/^MemAvailable:/{printf "%.0f", \$2/1024}' /proc/meminfo)
MEM_USED=\$((MEM_TOTAL - MEM_AVAIL))

# --- disks (GB), real filesystems only ---
DISKS=\$(df -PB1 -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs -x fuse.gvfsd-fuse 2>/dev/null \\
  | awk 'NR>1 && \$2+0>0 {printf "%s{\\"drive\\":\\"%s\\",\\"total_gb\\":%.2f,\\"used_gb\\":%.2f,\\"free_gb\\":%.2f}", (c++?",":""), \$6, \$2/1073741824, \$3/1073741824, \$4/1073741824}')
UPTIME=\$(awk '{printf "%d", \$1}' /proc/uptime)
NPROC=\$(nproc 2>/dev/null || echo 1)

# --- metrics (every run) ---
if [ -n "\$TOKEN" ]; then AUTH="\\"token\\":\\"\$TOKEN\\""; else AUTH="\\"registration_key\\":\\"\$REG_KEY\\""; fi
BODY="{\$AUTH,\\"hostname\\":\\"\$(esc "\$HOST")\\",\\"ip_address\\":\\"\$(esc "\$IP")\\",\\"os_info\\":\\"\$(esc "\$OS_INFO")\\",\\"agent_version\\":\\"\$AGENT_VERSION\\",\\"platform\\":\\"linux\\",\\"metrics\\":{\\"cpu_usage\\":\$CPU,\\"memory_total_mb\\":\$MEM_TOTAL,\\"memory_used_mb\\":\$MEM_USED,\\"uptime_seconds\\":\$UPTIME,\\"disks\\":[\$DISKS]}}"
RESP=\$(post "\$SERVER_URL/api/metrics" "\$BODY")

if [ -z "\$RESP" ]; then log "metrics failed"; exit 0; fi

NEWTOK=\$(jget "\$RESP" token)
if [ -n "\$NEWTOK" ] && [ "\$NEWTOK" != "\$TOKEN" ]; then
  TOKEN="\$NEWTOK"
  printf '{"token":"%s"}' "\$TOKEN" > "\$CONF"
  chmod 600 "\$CONF" 2>/dev/null
  log "registered, token stored"
fi
[ -z "\$TOKEN" ] && { log "no token"; exit 0; }

# --- processes (~every 3 min) ---
# CPU is a real delta over 1s from /proc/<pid>/stat, not ps's lifetime average,
# so it shows what is loading the box RIGHT NOW. The comm field is read from
# between the parentheses, so process titles containing spaces (e.g. renamed
# node/PM2 workers) can't shift the columns.
if due proc_at 150; then
  HZ=\$(getconf CLK_TCK 2>/dev/null || echo 100)
  PGSZ=\$(getconf PAGESIZE 2>/dev/null || echo 4096)
  psnap() {
    awk '{ f=FILENAME; sub("/proc/","",f); sub("/stat","",f);
           l=\$0; a=index(l,"("); b=0;
           for(i=length(l); i>0; i--) if (substr(l,i,1)==")") { b=i; break }
           if (a==0 || b==0 || b<a) next;
           c=substr(l,a+1,b-a-1); gsub(/[^A-Za-z0-9._:@-]/,"_",c);
           r=substr(l,b+2); split(r,F," ");
           print f"|"(F[12]+F[13])"|"c }' /proc/[0-9]*/stat 2>/dev/null
  }
  PA=\$(mktemp); PB=\$(mktemp)
  psnap > "\$PA"; sleep 1; psnap > "\$PB"
  ALL=\$(awk -v hz="\$HZ" -v np="\$NPROC" -v pg="\$PGSZ" -F'|' '
    NR==FNR { t[\$1]=\$2; next }
    {
      pid=\$1; d=\$2-((pid in t) ? t[pid] : \$2); if (d<0) d=0;
      cpu=d*100/hz/np;
      rss=0; sf="/proc/" pid "/statm";
      if ((getline line < sf) > 0) { split(line,m," "); rss=m[2]*pg/1048576 }
      close(sf);
      if (rss>0 || cpu>0) printf "%.2f|%.1f|%s|%s\\n", cpu, rss, pid, \$3
    }' "\$PA" "\$PB")
  rm -f "\$PA" "\$PB"
  # Top 15 by CPU plus top 10 by memory, deduped — so both UI sorts are useful.
  PICK=\$( { printf '%s\\n' "\$ALL" | sort -t'|' -k1 -rn | head -15
             printf '%s\\n' "\$ALL" | sort -t'|' -k2 -rn | head -10; } | awk -F'|' '!seen[\$3]++')
  PROCS=\$(printf '%s\\n' "\$PICK" | awk -F'|' 'NF==4 {printf "%s{\\"name\\":\\"%s\\",\\"pid\\":%d,\\"cpu_pct\\":%.1f,\\"mem_mb\\":%.1f}", (c++?",":""), substr(\$4,1,60), \$3, \$1, \$2}')
  [ -n "\$PROCS" ] && post "\$SERVER_URL/api/process-report" "{\\"token\\":\\"\$TOKEN\\",\\"hostname\\":\\"\$(esc "\$HOST")\\",\\"processes\\":[\$PROCS]}" >/dev/null
  st_set proc_at "\$NOW"
fi

# --- security (~every 5 min): failed/successful SSH logons in the last 30 min ---
if due sec_at 270; then
  RAW=\$(journalctl -u ssh -u sshd --since "30 min ago" --no-pager -q 2>/dev/null)
  [ -z "\$RAW" ] && [ -f /var/log/auth.log ] && RAW=\$(tail -n 500 /var/log/auth.log 2>/dev/null)
  SEC=\$(printf '%s\\n' "\$RAW" | awk '
    /Failed password/ {
      for(i=1;i<=NF;i++){ if(\$i=="from") ip=\$(i+1); if(\$i=="for") u=(\$(i+1)=="invalid"?\$(i+3):\$(i+1)) }
      if(ip!="") { gsub(/"/,"",u); gsub(/"/,"",ip); printf "%s{\\"event\\":\\"fail\\",\\"account\\":\\"%s\\",\\"ip\\":\\"%s\\",\\"logon_type\\":\\"ssh\\"}", (c++?",":""), u, ip }
    }
    /Accepted (password|publickey)/ {
      for(i=1;i<=NF;i++){ if(\$i=="from") ip=\$(i+1); if(\$i=="for") u=\$(i+1) }
      if(ip!="") { gsub(/"/,"",u); gsub(/"/,"",ip); printf "%s{\\"event\\":\\"success\\",\\"account\\":\\"%s\\",\\"ip\\":\\"%s\\",\\"logon_type\\":\\"ssh\\"}", (c++?",":""), u, ip }
    }')
  [ -n "\$SEC" ] && post "\$SERVER_URL/api/security" "{\\"token\\":\\"\$TOKEN\\",\\"hostname\\":\\"\$(esc "\$HOST")\\",\\"events\\":[\$SEC]}" >/dev/null
  st_set sec_at "\$NOW"
fi

# --- health (~every 10 min): failed systemd units + pending reboot ---
if due health_at 570; then
  SVC=\$(systemctl list-units --failed --no-legend --plain --no-pager 2>/dev/null \\
    | awk '{gsub(/"/,"",\$1); if(\$1!="") printf "%s{\\"name\\":\\"%s\\",\\"display\\":\\"%s\\"}", (c++?",":""), \$1, \$1}')
  REBOOT=false
  [ -f /var/run/reboot-required ] && REBOOT=true
  post "\$SERVER_URL/api/health-report" "{\\"token\\":\\"\$TOKEN\\",\\"hostname\\":\\"\$(esc "\$HOST")\\",\\"pending_reboot\\":\$REBOOT,\\"services\\":[\$SVC],\\"certs\\":[],\\"tasks\\":[]}" >/dev/null
  st_set health_at "\$NOW"
fi

# --- inventory (~daily): hardware + installed packages + patch status ---
if due inv_at 82800; then
  VENDOR=\$(cat /sys/class/dmi/id/sys_vendor 2>/dev/null)
  MODEL=\$(cat /sys/class/dmi/id/product_name 2>/dev/null)
  SERIAL=\$(cat /sys/class/dmi/id/product_serial 2>/dev/null)
  CPUM=\$(awk -F': ' '/^model name/{print \$2; exit}' /proc/cpuinfo)
  CORES=\$(awk -F': ' '/^cpu cores/{print \$2; exit}' /proc/cpuinfo); [ -z "\$CORES" ] && CORES=\$NPROC
  RAMGB=\$(awk '/^MemTotal:/{printf "%.1f", \$2/1048576}' /proc/meminfo)
  KERNEL=\$(uname -r)
  HWDISKS=\$(lsblk -bdn -o NAME,MODEL,SIZE 2>/dev/null | awk '\$NF+0>0 {m=""; for(i=2;i<NF;i++) m=m (m?" ":"") \$i; gsub(/"/,"",m); printf "%s{\\"model\\":\\"%s\\",\\"size_gb\\":%.1f,\\"media\\":\\"%s\\"}", (c++?",":""), (m?m:\$1), \$NF/1073741824, "disk"}')
  SW=\$(dpkg-query -W -f='\${Package}\\t\${Version}\\t\${Maintainer}\\n' 2>/dev/null | head -1000 \\
    | awk -F'\\t' '{gsub(/"/,"",\$1); gsub(/"/,"",\$2); gsub(/"/,"",\$3); printf "%s{\\"name\\":\\"%s\\",\\"version\\":\\"%s\\",\\"publisher\\":\\"%s\\"}", (c++?",":""), \$1, \$2, \$3}')
  LASTP=\$(grep -a '^Start-Date:' /var/log/apt/history.log 2>/dev/null | tail -1 | awk '{print \$2}')
  [ -z "\$LASTP" ] && LASTP=\$(date -r /var/lib/dpkg/status +%Y-%m-%d 2>/dev/null)
  PATCHES="{\\"last_installed\\":\\"\${LASTP:-}\\",\\"hotfixes\\":[]}"
  HW="{\\"manufacturer\\":\\"\$(esc "\$VENDOR")\\",\\"model\\":\\"\$(esc "\$MODEL")\\",\\"serial\\":\\"\$(esc "\$SERIAL")\\",\\"os_caption\\":\\"\$(esc "\$OS_INFO")\\",\\"os_version\\":\\"\$(esc "\$KERNEL")\\",\\"os_build\\":\\"\$(esc "\$KERNEL")\\",\\"cpu\\":\\"\$(esc "\$CPUM")\\",\\"cpu_cores\\":\${CORES:-0},\\"cpu_logical\\":\${NPROC:-0},\\"ram_gb\\":\${RAMGB:-0},\\"disks\\":[\$HWDISKS]}"
  post "\$SERVER_URL/api/inventory-report" "{\\"token\\":\\"\$TOKEN\\",\\"hostname\\":\\"\$(esc "\$HOST")\\",\\"hardware\\":\$HW,\\"software\\":[\$SW],\\"patches\\":\$PATCHES}" >/dev/null
  st_set inv_at "\$NOW"
fi

# --- one-shot commands from the backend ---
CMDS=\$(sed -n 's/.*"commands":\\[\\(.*\\)\\],"agent_latest".*/\\1/p' <<< "\$RESP")
if [ -n "\$CMDS" ]; then
  printf '%s\\n' "\$CMDS" | tr '}' '}\\n' | while read -r c; do
    [ -z "\$c" ] && continue
    CID=\$(jgetnum "\$c" id); CT=\$(jget "\$c" ctype); CP=\$(jget "\$c" param)
    [ -z "\$CID" ] && continue
    OK=false; MSG=""
    case "\$CT" in
      restart_service)
        if systemctl restart "\$CP" 2>>"\$LOG"; then OK=true; MSG="restarted \$CP"; else MSG="failed to restart \$CP"; fi ;;
      reboot) OK=true; MSG="rebooting" ;;
      force_update) OK=true; MSG="update queued" ;;
      uninstall_agent) OK=true; MSG="uninstalling" ;;
      *) MSG="unsupported on linux: \$CT" ;;
    esac
    post "\$SERVER_URL/api/commands/\$CID/report" "{\\"token\\":\\"\$TOKEN\\",\\"success\\":\$OK,\\"result\\":\\"\$(esc "\$MSG")\\"}" >/dev/null
    if [ "\$CT" = "uninstall_agent" ]; then
      systemctl disable --now winserv-agent.timer 2>/dev/null
      rm -f /etc/systemd/system/winserv-agent.timer /etc/systemd/system/winserv-agent.service
      systemctl daemon-reload 2>/dev/null
      rm -rf /opt/winserv-agent "\$CONF_DIR"
      exit 0
    fi
    if [ "\$CT" = "reboot" ]; then ( sleep 3; systemctl reboot ) & fi
    if [ "\$CT" = "force_update" ]; then st_set force_update 1; fi
  done
fi

# --- self-update: retry with a fresh connection (slow/inspected links stall) ---
LATEST=\$(jget "\$RESP" linux_agent_latest)
FORCE=\$(st_get force_update)
if [ -n "\$LATEST" ] && { [ "\$LATEST" != "\$AGENT_VERSION" ] || [ "\$FORCE" = "1" ]; }; then
  TMP=\$(mktemp)
  for i in 1 2 3 4; do
    if curl -fsS --max-time 120 "\$SERVER_URL/api/agent/linux-script?token=\$TOKEN" -o "\$TMP" 2>>"\$LOG" \\
       && grep -q "WinServ Monitoring Linux Agent" "\$TMP" \\
       && [ "\$(wc -c < "\$TMP")" -gt 500 ]; then
      install -m 700 "\$TMP" "\$SELF" && log "self-updated \$AGENT_VERSION -> \$LATEST"
      st_set force_update 0
      break
    fi
    log "self-update attempt \$i failed"
    sleep 4
  done
  rm -f "\$TMP"
fi

exit 0
`;
}

// Root installer, fetched with the registration key. Writes the agent + a
// systemd timer, then runs it once so the host appears immediately.
function generateLinuxInstaller(serverUrl, regKey) {
  return `#!/usr/bin/env bash
# WinServ Monitoring — Linux agent installer
set -e
[ "\$(id -u)" -eq 0 ] || { echo "Run as root: pipe through 'sudo bash'"; exit 1; }

command -v curl >/dev/null 2>&1 || { echo "Installing curl..."; apt-get update -qq && apt-get install -y -qq curl; }

mkdir -p /opt/winserv-agent /etc/winserv-agent
echo "Downloading agent..."
curl -fsSL "${serverUrl}/api/agent/linux-script?key=${encodeURIComponent(regKey)}" -o /opt/winserv-agent/agent.sh
chmod 700 /opt/winserv-agent/agent.sh

cat > /etc/systemd/system/winserv-agent.service <<'UNIT'
[Unit]
Description=WinServ Monitoring Agent
After=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/winserv-agent/agent.sh
UNIT

cat > /etc/systemd/system/winserv-agent.timer <<'UNIT'
[Unit]
Description=WinServ Monitoring Agent timer

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now winserv-agent.timer >/dev/null 2>&1
echo "Running first check-in..."
systemctl start winserv-agent.service || /opt/winserv-agent/agent.sh

echo ""
echo "Installed. \$(hostname -f) appears in the dashboard within 1-2 minutes."
echo "Logs: /var/log/winserv-agent.log   Status: systemctl status winserv-agent.timer"
`;
}

module.exports = { LINUX_AGENT_VERSION, generateLinuxScript, generateLinuxInstaller };
