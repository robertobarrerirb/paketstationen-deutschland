'use client';

import MunicipalityOverviewPanels from './overview/MunicipalityOverviewPanels';
import { MunicipalityHistoryEntry } from '@/types/history';
import { useI18n } from '@/lib/i18n';

interface MunicipalityHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  municipalityName: string;
  municipalitySlug: string;
  history: MunicipalityHistoryEntry[];
}

/**
 * Modal chrome around MunicipalityOverviewPanels.
 *
 * The panels themselves live in components/overview so the dashboard button on
 * a Data Matrix row and /data-export/statistieken show the same overview.
 */
export default function MunicipalityHistoryModal({
  isOpen,
  onClose,
  municipalityName,
  history,
}: MunicipalityHistoryModalProps) {
  const { t } = useI18n();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-card rounded-t-xl sm:rounded-lg shadow-xl w-full sm:max-w-6xl max-h-[85vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border flex justify-between items-center">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-foreground">{municipalityName}</h2>
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
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <MunicipalityOverviewPanels history={history} />
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
