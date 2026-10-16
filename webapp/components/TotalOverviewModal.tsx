'use client';

import TotalOverviewPanels from './overview/TotalOverviewPanels';
import { HistorySnapshot } from '@/types/history';
import { useI18n } from '@/lib/i18n';

interface TotalOverviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  snapshots: HistorySnapshot[];
  providers: string[];
}

/**
 * Modal chrome around TotalOverviewPanels.
 *
 * The panels themselves live in components/overview so the Data Matrix modal
 * and /data-export/statistieken show the same overview rather than two copies.
 */
export default function TotalOverviewModal({
  isOpen,
  onClose,
  snapshots,
  providers,
}: TotalOverviewModalProps) {
  const { t } = useI18n();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-card rounded-t-xl sm:rounded-lg shadow-xl w-full sm:max-w-6xl max-h-[85vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-b border-border flex justify-between items-center">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-foreground">
              {t('overview.totalTitle')}
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {t('overview.shareGrowth')}
            </p>
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
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
          <TotalOverviewPanels snapshots={snapshots} providers={providers} />
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted">
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
