/**
 * Boundary loader.
 *
 * Commune outlines ship as one file per Kreis (public/data/boundaries/,
 * written by scripts/prepare_territoire.py), so a view loads only what it
 * draws: a Kreis its own file, a Land the files of its Kreise.
 * The Germany view draws the ~400 Kreis outlines (one small file):
 * 35,000 commune outlines would be far too heavy for a national map.
 */

export interface DepartmentMetadata {
  name: string;
  code: string;
  slug: string;
  region_slug: string;
  file: string;
  size_mb: number;
  boundaries_count: number;
}

export interface BoundaryIndex {
  generated_at: string;
  departments_file: string;
  total_departments: number;
  total_boundaries: number;
  departments: DepartmentMetadata[];
}

export interface BoundaryLoadProgress {
  loaded: number;
  total: number;
  current?: string;
  percentage: number;
}

export interface BoundaryData {
  type: 'FeatureCollection';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  features: any[];
  metadata: {
    total_boundaries: number;
    files_loaded: number;
  };
}

export async function getBoundaryIndex(): Promise<BoundaryIndex> {
  const response = await fetch('/data/boundaries/index.json');
  if (!response.ok) {
    throw new Error(`Failed to load boundary index: ${response.status}`);
  }
  return response.json();
}

async function loadFiles(
  files: { name: string; file: string }[],
  onProgress?: (progress: BoundaryLoadProgress) => void,
): Promise<BoundaryData> {
  let loaded = 0;
  const total = files.length;
  const results = await Promise.all(
    files.map(async ({ name, file }) => {
      try {
        const response = await fetch(`/data/${file}`);
        if (!response.ok) throw new Error(`${name}: ${response.status}`);
        const data = await response.json();
        return data.features ?? [];
      } catch (error) {
        console.error(`Error loading ${name}:`, error);
        return [];
      } finally {
        loaded++;
        onProgress?.({ loaded, total, current: name, percentage: Math.round((loaded / total) * 100) });
      }
    }),
  );
  const features = results.flat();
  return {
    type: 'FeatureCollection',
    features,
    metadata: { total_boundaries: features.length, files_loaded: results.filter((r) => r.length).length },
  };
}

/** The ~400 Kreis outlines (Germany view). */
export async function loadDepartmentOutlines(
  onProgress?: (progress: BoundaryLoadProgress) => void,
): Promise<BoundaryData> {
  const index = await getBoundaryIndex();
  return loadFiles([{ name: 'Kreise', file: index.departments_file }], onProgress);
}

/**
 * Commune outlines of one area: a Kreis slug loads that Kreis,
 * a Land slug every Kreis of the Land.
 */
export async function loadCommuneOutlines(
  areaSlug: string,
  onProgress?: (progress: BoundaryLoadProgress) => void,
): Promise<BoundaryData> {
  const index = await getBoundaryIndex();
  const selected = index.departments.filter((d) => d.slug === areaSlug || d.region_slug === areaSlug);
  return loadFiles(selected.map((d) => ({ name: d.name, file: d.file })), onProgress);
}
