/**
 * Cross-platform CPU load monitor.
 *
 * Node's os.loadavg() is always [0, 0, 0] on Windows, so utilization is derived
 * from os.cpus() idle/total deltas. On Unix, loadavg is still exposed for status.
 */

const os = require('os');
const logger = require('./logger');

const SAMPLE_INTERVAL_MS = 5000;
const HISTORY_MAX_LENGTH = 12;
const SUSTAINED_WINDOW = 6;
const SUSTAINED_HIGH_COUNT = 4;

function readCpuTimes() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    const times = cpu.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + (times.irq || 0);
  }

  return { idle, total };
}

function hasLoadavgSupport() {
  return process.platform !== 'win32';
}

class CpuLoadMonitor {
  constructor() {
    this.cachedLoad = 0;
    this.history = [];
    this.previousCpuTimes = null;
    this.intervalId = null;
    this.useLoadavg = hasLoadavgSupport();
  }

  start() {
    if (this.intervalId) return;

    this.sample();
    this.intervalId = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
    this.intervalId.unref?.();
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  sample() {
    const load = this.useLoadavg ? this.sampleLoadavg() : this.sampleCpuUtilization();
    this.cachedLoad = load;
    this.history.push({ time: Date.now(), load });

    if (this.history.length > HISTORY_MAX_LENGTH) {
      this.history.shift();
    }
  }

  sampleLoadavg() {
    const [oneMinute] = os.loadavg();
    const cpuCount = os.cpus().length || 1;
    return oneMinute / cpuCount;
  }

  sampleCpuUtilization() {
    const current = readCpuTimes();

    if (!this.previousCpuTimes) {
      this.previousCpuTimes = current;
      return 0;
    }

    const idleDelta = current.idle - this.previousCpuTimes.idle;
    const totalDelta = current.total - this.previousCpuTimes.total;
    this.previousCpuTimes = current;

    if (totalDelta <= 0) {
      return this.cachedLoad;
    }

    const utilization = 1 - idleDelta / totalDelta;
    return Math.min(1, Math.max(0, utilization));
  }

  getLoad() {
    return this.cachedLoad;
  }

  getHistory(limit = 6) {
    return this.history.slice(-limit);
  }

  shouldAccept(threshold) {
    const cpuLoad = this.cachedLoad;

    if (cpuLoad > threshold) {
      logger.warn('CPU load too high, pausing task queue', {
        cpuLoad: cpuLoad.toFixed(2),
        threshold,
        method: this.useLoadavg ? 'loadavg' : 'cpu-utilization',
      });
      return false;
    }

    const recentHighLoad = this.history
      .slice(-SUSTAINED_WINDOW)
      .filter((entry) => entry.load > threshold);

    if (recentHighLoad.length >= SUSTAINED_HIGH_COUNT) {
      logger.warn('Sustained high CPU load detected', {
        highLoadCount: recentHighLoad.length,
        method: this.useLoadavg ? 'loadavg' : 'cpu-utilization',
      });
      return false;
    }

    return true;
  }

  getStatus() {
    return {
      load: this.cachedLoad,
      method: this.useLoadavg ? 'loadavg' : 'cpu-utilization',
      history: this.getHistory(),
      systemLoadavg: os.loadavg(),
      cpuCores: os.cpus().length,
      platform: process.platform,
    };
  }
}

const cpuLoadMonitor = new CpuLoadMonitor();

module.exports = {
  cpuLoadMonitor,
  CpuLoadMonitor,
  SAMPLE_INTERVAL_MS,
};
