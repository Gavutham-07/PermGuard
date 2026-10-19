import { RiskLevel } from '../types';

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return 'Unavailable';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

export function getRiskColorClass(level: RiskLevel | string): string {
  switch (level) {
    case 'HIGH':
      return 'bg-[#E53935] text-white';
    case 'MEDIUM':
      return 'bg-[#FB8C00] text-white';
    default:
      return 'bg-[#43A047] text-white';
  }
}

export function getRiskHexColor(level: RiskLevel | string): string {
  switch (level) {
    case 'HIGH':
      return '#E53935';
    case 'MEDIUM':
      return '#FB8C00';
    default:
      return '#43A047';
  }
}
