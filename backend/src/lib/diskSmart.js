'use strict';

// Physical disk health (SMART) as reported by the Windows agent.
//
// The agent sends raw Storage-module / WMI values, which arrive in two shapes:
// modern hosts give enum NAMES ("Healthy", "SSD", "NVMe"), older ones the raw
// numbers (0, 4, 17). Everything is normalised here so the rest of the code
// sees one vocabulary. Pure and unit-tested.

const HEALTH = { 0: 'ok', 1: 'warning', 2: 'failing', 5: 'unknown', healthy: 'ok', warning: 'warning', unhealthy: 'failing', unknown: 'unknown' };
const MEDIA = { 3: 'hdd', 4: 'ssd', 5: 'scm', hdd: 'hdd', ssd: 'ssd', scm: 'scm' };
const BUS = {
  1: 'scsi', 2: 'atapi', 3: 'ata', 6: 'fc', 7: 'usb', 8: 'raid', 9: 'iscsi', 10: 'sas', 11: 'sata',
  12: 'sd', 13: 'mmc', 14: 'virtual', 15: 'virtual', 16: 'spaces', 17: 'nvme',
  scsi: 'scsi', atapi: 'atapi', ata: 'ata', 'fibre channel': 'fc', usb: 'usb', raid: 'raid', iscsi: 'iscsi',
  sas: 'sas', sata: 'sata', sd: 'sd', mmc: 'mmc', virtual: 'virtual', 'file backed virtual': 'virtual',
  'storage spaces': 'spaces', nvme: 'nvme', ide: 'ata',
};
// Hypervisor and SAN volumes have no SMART of their own; the host owns it.
const VIRTUAL_MODEL = /virtual disk|vmware|qemu|vbox|virtio|xen|msft virtual|hyper-v|red hat|nutanix|\bvdisk\b/i;

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const key = (map, v) => {
  if (v === null || v === undefined || v === '') return null;
  return map[String(v).trim().toLowerCase()] ?? null;
};
const str = (v, n) => String(v ?? '').trim().slice(0, n);

// Temperature at which a drive is "hot", unless the drive declares its own max.
const HOT_C = { hdd: 55, ssd: 70, nvme: 75, default: 60 };
const WEAR_WARN = 90; // % of rated endurance used

function normalizeDisk(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const model = str(raw.model, 120);
  const bus = key(BUS, raw.bus);
  if (bus === 'virtual' || bus === 'iscsi' || bus === 'usb' || VIRTUAL_MODEL.test(model)) return null;

  const serial = str(raw.serial, 80);
  const id = str(raw.id, 40);
  const opStatus = (Array.isArray(raw.op_status) ? raw.op_status : [raw.op_status])
    .map(s => str(s, 40)).filter(Boolean).join(', ').slice(0, 120);
  const sizeBytes = num(raw.size);
  const wear = num(raw.wear);
  let temp = num(raw.temp);
  if (temp !== null && (temp <= 0 || temp > 150)) temp = null; // 0 = sensor not exposed
  let tempMax = num(raw.temp_max);
  if (tempMax !== null && (tempMax <= 0 || tempMax > 150)) tempMax = null;

  // Behind a hardware RAID controller Windows sees only the logical drive: the
  // controller fills the counters with placeholders (wear 0), not real SMART.
  const raid = bus === 'raid';
  return {
    // The serial survives a re-cabling or a renumbered DeviceId; fall back only when it is absent.
    key: (serial || `${id}:${model}`).slice(0, 120),
    model,
    serial,
    media: key(MEDIA, raw.media) || (bus === 'nvme' ? 'ssd' : null),
    bus,
    size_gb: sizeBytes !== null ? Math.round(sizeBytes / 1e9) : null,
    health: key(HEALTH, raw.health) || 'unknown',
    op_status: opStatus,
    predict_failure: raw.predict_failure === true || raw.predict_failure === 1 || raw.predict_failure === 'true',
    temp: raid ? null : temp,
    temp_max: raid ? null : tempMax,
    wear: !raid && wear !== null && wear >= 0 && wear <= 200 ? wear : null,
    power_on_hours: raid ? null : num(raw.power_on_hours),
    read_unc: raid ? null : num(raw.read_unc),
    write_unc: raid ? null : num(raw.write_unc),
    raid,
  };
}

// 0 = fine, 1 = warning, 2 = critical. reasons are stable codes for the UI.
function assessDisk(d, prev) {
  const reasons = [];
  let level = 0;
  const bump = (l, code) => { reasons.push(code); if (l > level) level = l; };

  if (d.predict_failure) bump(2, 'predict');
  if (d.health === 'failing') bump(2, 'unhealthy');
  if (/predictive failure|pred fail|failed|lost communication|io error/i.test(d.op_status)) bump(2, 'opstatus');
  if (d.health === 'warning') bump(1, 'degraded');
  if (d.wear !== null && d.wear >= WEAR_WARN) bump(1, 'wear');
  // TemperatureMax is a lifetime peak on some drives and a limit on others, so
  // it is shown but never used as the threshold.
  const hot = HOT_C[d.bus === 'nvme' ? 'nvme' : d.media] || HOT_C.default;
  if (d.temp !== null && d.temp >= hot) bump(1, 'hot');

  // Uncorrectable errors are events, not a state: they matter when they grow.
  let newErrors = 0;
  if (prev) {
    for (const f of ['read_unc', 'write_unc']) {
      const a = num(prev[f]), b = d[f];
      if (a !== null && b !== null && b > a) newErrors += b - a;
    }
  }

  return { level, reasons, newErrors };
}

// Level transition -> what to announce: 'critical' | 'warning' | 'recovered' |
// 'errors' | null. New uncorrectable errors are announced on their own and do
// not raise the level - otherwise the next clean pass would send "recovered".
function smartTransition(prevLevel, cur) {
  const p = Number(prevLevel) || 0;
  if (cur.level > p) return cur.level === 2 ? 'critical' : 'warning';
  if (cur.level === 0 && p > 0) return 'recovered';
  if (cur.newErrors > 0) return 'errors';
  return null;
}

module.exports = { normalizeDisk, assessDisk, smartTransition, WEAR_WARN };
