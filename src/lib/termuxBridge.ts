export class TermuxBridge {
  static async executeCommand(command: string): Promise<any> {
    try {
      const res = await fetch('/api/termux/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });
      const data = await res.json();
      if (data.success) {
        return data.output;
      }
      throw new Error(data.error);
    } catch (err) {
      console.warn(`[TermuxBridge] Failed execution for: ${command}`, err);
      return null;
    }
  }

  static async getBatteryStatus(): Promise<{ batteryLevel: number; batteryStatus: 'charging' | 'discharging' | 'full'; temperatureC: number; batteryPercent: number; isCharging: boolean; thermalTempC: number } | null> {
    const output = await this.executeCommand('termux-battery-status');
    if (output && typeof output === 'object') {
      let status: 'charging' | 'discharging' | 'full' = 'discharging';
      if (output.status === 'CHARGING') status = 'charging';
      else if (output.status === 'FULL') status = 'full';

      return {
        batteryLevel: output.percentage ?? 100,
        batteryPercent: output.percentage ?? 100,
        batteryStatus: status,
        isCharging: status === 'charging' || status === 'full',
        temperatureC: output.temperature ?? 35.0,
        thermalTempC: output.temperature ?? 35.0
      };
    }
    return null;
  }

  static async getLightSensor(): Promise<{ termuxLightLux: number } | null> {
    const output = await this.executeCommand('termux-sensor -s "light" -n 1');
    if (output && output['light'] && output['light'].values) {
      return { termuxLightLux: output['light'].values[0] };
    }
    return null;
  }

  static async getSystemInfo(): Promise<{ ramUsedGb: number; ramTotalGb: number } | null> {
    // "free -m" output parsing could be complex, or just use termux-info?
    // Let's rely on backend for OS telemetry, or basic top.
    // termux-api doesn't have a direct memory info command, usually `free -m` works.
    const output = await this.executeCommand('free -m');
    if (typeof output === 'string') {
      // Very basic parse
      const match = output.match(/Mem:\s+(\d+)\s+(\d+)/);
      if (match) {
        return {
          ramTotalGb: parseInt(match[1]) / 1024,
          ramUsedGb: parseInt(match[2]) / 1024
        };
      }
    }
    return null;
  }
}
