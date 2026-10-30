const test = require('node:test');
const assert = require('node:assert');
const { normalizeDisk, assessDisk, smartTransition } = require('../src/lib/diskSmart');

const ssd = { id: '0', model: 'Samsung SSD 870 EVO 1TB', serial: 'S6P', media: 'SSD', bus: 'SATA', size: 1000204886016,
  health: 'Healthy', op_status: ['OK'], temp: 35, wear: 3, power_on_hours: 12000, read_unc: 0, write_unc: 0 };

test('normalizes enum names and raw numbers to the same values', () => {
  const a = normalizeDisk(ssd);
  const b = normalizeDisk({ ...ssd, media: 4, bus: 11, health: 0 });
  for (const d of [a, b]) {
    assert.strictEqual(d.media, 'ssd');
    assert.strictEqual(d.bus, 'sata');
    assert.strictEqual(d.health, 'ok');
  }
  assert.strictEqual(a.size_gb, 1000);
  assert.strictEqual(a.key, 'S6P');
  assert.strictEqual(a.op_status, 'OK');
});

test('drops virtual, iSCSI and USB disks', () => {
  assert.strictEqual(normalizeDisk({ ...ssd, model: 'Msft Virtual Disk', bus: 'SAS' }), null);
  assert.strictEqual(normalizeDisk({ ...ssd, bus: 'File Backed Virtual' }), null);
  assert.strictEqual(normalizeDisk({ ...ssd, bus: 15 }), null);
  assert.strictEqual(normalizeDisk({ ...ssd, model: 'VMware Virtual disk SCSI Disk Device', bus: 'SAS' }), null);
  assert.strictEqual(normalizeDisk({ ...ssd, bus: 'USB' }), null);
  assert.strictEqual(normalizeDisk({ ...ssd, bus: 'iSCSI' }), null);
});

test('flags RAID logical drives and infers SSD for NVMe', () => {
  assert.strictEqual(normalizeDisk({ ...ssd, bus: 'RAID', model: 'DELL PERC H730 SCSI Disk Device' }).raid, true);
  assert.strictEqual(normalizeDisk({ ...ssd, bus: 'NVMe', media: 0 }).media, 'ssd');
});

test('ignores a zero temperature and keys by device id without a serial', () => {
  const d = normalizeDisk({ ...ssd, serial: '', temp: 0 });
  assert.strictEqual(d.temp, null);
  assert.strictEqual(d.key, '0:Samsung SSD 870 EVO 1TB');
});

test('healthy disk is level 0', () => {
  assert.deepStrictEqual(assessDisk(normalizeDisk(ssd), null), { level: 0, reasons: [], newErrors: 0 });
});

test('failure prediction and unhealthy status are critical', () => {
  assert.strictEqual(assessDisk(normalizeDisk({ ...ssd, predict_failure: true }), null).level, 2);
  assert.strictEqual(assessDisk(normalizeDisk({ ...ssd, health: 'Unhealthy' }), null).level, 2);
  assert.strictEqual(assessDisk(normalizeDisk({ ...ssd, op_status: ['Predictive Failure'] }), null).level, 2);
  assert.strictEqual(assessDisk(normalizeDisk({ ...ssd, op_status: 'Pred Fail', health: 'Unknown' }), null).level, 2);
});

test('wear, heat and degraded health are warnings', () => {
  assert.deepStrictEqual(assessDisk(normalizeDisk({ ...ssd, wear: 95 }), null).reasons, ['wear']);
  assert.deepStrictEqual(assessDisk(normalizeDisk({ ...ssd, temp: 71 }), null).reasons, ['hot']);
  assert.strictEqual(assessDisk(normalizeDisk({ ...ssd, temp: 60 }), null).level, 0); // fine for an SSD
  assert.strictEqual(assessDisk(normalizeDisk({ ...ssd, media: 'HDD', temp: 56 }), null).level, 1);
  assert.strictEqual(assessDisk(normalizeDisk({ ...ssd, temp: 50, temp_max: 45 }), null).level, 0); // peak is not a limit
  assert.strictEqual(assessDisk(normalizeDisk({ ...ssd, health: 'Warning' }), null).level, 1);
});

test('growing uncorrectable errors are counted but do not raise the level', () => {
  const prev = { read_unc: 2, write_unc: 0 };
  const r = assessDisk(normalizeDisk({ ...ssd, read_unc: 5, write_unc: 1 }), prev);
  assert.strictEqual(r.newErrors, 4);
  assert.strictEqual(r.level, 0);
  assert.strictEqual(assessDisk(normalizeDisk({ ...ssd, read_unc: 2 }), prev).newErrors, 0);
});

test('transitions announce only changes', () => {
  assert.strictEqual(smartTransition(0, { level: 2, newErrors: 0 }), 'critical');
  assert.strictEqual(smartTransition(0, { level: 1, newErrors: 0 }), 'warning');
  assert.strictEqual(smartTransition(1, { level: 2, newErrors: 0 }), 'critical');
  assert.strictEqual(smartTransition(2, { level: 2, newErrors: 0 }), null);
  assert.strictEqual(smartTransition(2, { level: 1, newErrors: 0 }), null);
  assert.strictEqual(smartTransition(1, { level: 0, newErrors: 0 }), 'recovered');
  assert.strictEqual(smartTransition(0, { level: 0, newErrors: 3 }), 'errors');
});
