import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import manifest from '../../manifest.json';
import pkg from '../../package.json';
describe('release manifest', () => {
  it('declares the MV3 module worker and the action shortcut', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('Grouping Gang');
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(manifest.commands._execute_action.suggested_key.mac).toBe('Command+Shift+Period');
  });
  it('requests only the documented API permissions and no website access', () => {
    expect(manifest.permissions).toEqual(['tabs', 'tabGroups', 'storage', 'sessions']);
    expect(manifest).not.toHaveProperty('host_permissions');
    expect(manifest).not.toHaveProperty('content_scripts');
  });
  it('includes correctly sized PNG icons', () => {
    for (const [size, path] of Object.entries(manifest.icons)) {
      const data = readFileSync(`public/${path}`);
      expect(data.subarray(1, 4).toString()).toBe('PNG');
      expect(data.readUInt32BE(16)).toBe(Number(size));
      expect(data.readUInt32BE(20)).toBe(Number(size));
    }
  });
});
