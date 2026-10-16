export interface ProviderCounts {
  [provider: string]: number;
}

export interface HistorySnapshot {
  date: string;
  week: number;
  year: number;
  week_label: string;
  date_from: string;
  date_to: string;
  totals: {
    total: number;
    providers: ProviderCounts;
  };
}

export interface MunicipalityHistoryEntry {
  date: string;
  week: number;
  year: number;
  week_label: string;
  date_from: string;
  date_to: string;
  total: number;
  providers: ProviderCounts;
}

export interface MunicipalityHistory {
  history: MunicipalityHistoryEntry[];
}

export interface HistoryTrend {
  period: {
    from: string;
    to: string;
    weeks: number;
  };
  change: {
    total: number;
    providers: ProviderCounts;
  };
}

export interface HistoryData {
  generated_at: string;
  snapshots: HistorySnapshot[];
  municipalities: {
    [slug: string]: MunicipalityHistory;
  };
  trend?: HistoryTrend;
}
