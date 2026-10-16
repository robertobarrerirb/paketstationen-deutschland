import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const summaryPath = path.join(process.cwd(), 'public', 'data', 'summary.json');

    if (!fs.existsSync(summaryPath)) {
      return NextResponse.json({ error: 'Summary not available' }, { status: 404 });
    }

    const summaryData = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));

    // Per-carrier cache freshness, lifted out of statistics.json rather than
    // read from data/*_all_locations.json: those live outside webapp/, and this
    // keeps the large statistics file server-side instead of shipping it.
    let bronnen = null;
    try {
      const statisticsPath = path.join(process.cwd(), 'public', 'data', 'statistics.json');
      bronnen = JSON.parse(fs.readFileSync(statisticsPath, 'utf-8')).bronnen ?? null;
    } catch {
      // Statistics not generated yet; the page just omits the section.
    }

    const repository = process.env.GITHUB_REPOSITORY || 'robertobarrerirb/paketstationen-deutschland';
    return NextResponse.json({
      last_update: summaryData.generated_at,
      total_municipalities: summaryData.total_municipalities,
      carrier_stats: summaryData.carrier_stats || {},
      bronnen,
      github_actions_url: `https://github.com/${repository}/actions/workflows/update-data.yml`,
    });
  } catch (error) {
    console.error('Error reading update status:', error);
    return NextResponse.json({ error: 'Could not read the status' }, { status: 500 });
  }
}
