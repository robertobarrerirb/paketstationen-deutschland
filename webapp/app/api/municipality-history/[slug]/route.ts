import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

import { MunicipalityHistoryEntry, HistoryData } from '@/types/history';
import { isAggregateSlug } from '@/lib/territory';

export const dynamic = 'force-dynamic';

const DATA_DIR = path.join(process.cwd(), 'public', 'data');

interface IndexEntry {
  slug: string;
  department_slug: string | null;
  kind?: string;
}

let departmentBySlug: Map<string, string> | null = null;

/** commune slug -> 'departement-<name>' (history files are split by Kreis). */
function departmentOf(slug: string): string | null {
  if (!departmentBySlug) {
    const index = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'public', 'municipalities.json'), 'utf-8')
    ) as IndexEntry[];
    departmentBySlug = new Map(
      index.filter((e) => e.kind === 'commune' && e.department_slug).map((e) => [e.slug, e.department_slug as string])
    );
  }
  return departmentBySlug.get(slug) ?? null;
}

/**
 * One area's history (one entry per update).
 *
 * Germany, the Länder and the Kreise live in totals_history.json; the
 * ~10,800 Gemeinden are split by Kreis into history/<departement>.json,
 * so a request reads one small file.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;

    let file: string;
    if (isAggregateSlug(slug)) {
      file = path.join(DATA_DIR, 'totals_history.json');
    } else {
      const department = departmentOf(slug);
      if (!department) {
        return NextResponse.json({ error: `Unknown commune: '${slug}'`, slug, history: [] }, { status: 404 });
      }
      file = path.join(DATA_DIR, 'history', `${department}.json`);
    }

    if (!fs.existsSync(file)) {
      return NextResponse.json({ error: 'History not available' }, { status: 404 });
    }

    const history = JSON.parse(fs.readFileSync(file, 'utf-8')) as Pick<HistoryData, 'municipalities'>;
    const entries: MunicipalityHistoryEntry[] = history.municipalities?.[slug]?.history ?? [];

    if (entries.length === 0) {
      return NextResponse.json({ error: `No history for '${slug}'`, slug, history: [] }, { status: 404 });
    }

    return NextResponse.json({ slug, history: entries });
  } catch (error) {
    console.error('Error reading municipality history:', error);
    return NextResponse.json({ error: 'Could not read the history' }, { status: 500 });
  }
}
