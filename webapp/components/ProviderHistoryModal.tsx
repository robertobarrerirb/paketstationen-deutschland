'use client';

import ProviderOverviewPanels from './overview/ProviderOverviewPanels';
import { carrierColor, carrierLogo, carrierLabel, carrierInitials } from '@/lib/carriers';
import { HistorySnapshot } from '@/types/history';
import { useI18n } from '@/lib/i18n';

interface ProviderHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerName: string;
  snapshots: HistorySnapshot[];
}

/**
 * Modal chrome around ProviderOverviewPanels.
 *
 * The panels themselves live in components/overview so the Data Matrix modal
 * and /data-export/statistieken show the same overview rather than two copies.
 */
export default function ProviderHistoryModal({
  isOpen,
  onClose,
  providerName,
  snapshots,
}: ProviderHistoryModalProps) {
  const { t } = useI18n();
  if (!isOpen) return null;

  const logo = carrierLogo(providerName);
  const providerColor = carrierColor(providerName);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-card rounded-t-xl sm:rounded-lg shadow-xl w-full sm:max-w-6xl max-h-[85vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border flex justify-between items-center">
          <div className="flex items-center gap-3">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt={providerName} className="w-10 h-10 object-contain" />
            ) : (
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: providerColor }}
              >
                <span className="text-white font-bold text-sm">
                  {carrierInitials(providerName)}
                </span>
              </div>
            )}
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-foreground">{carrierLabel(providerName)}</h2>
              <p className="text-xs sm:text-sm text-muted-foreground">
                {t('overview.providerHistory')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 -mr-2 text-subtle-foreground hover:text-muted-foreground hover:bg-secondary rounded-full transition"
            aria-label={t('common.close')}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <ProviderOverviewPanels providerName={providerName} snapshots={snapshots} />
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted">
          <button
            onClick={onClose}
            className="w-full px-4 py-3 sm:py-2 bg-primary text-white rounded-lg hover:bg-primary/90 active:bg-primary/80 transition font-medium text-base sm:text-sm"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
