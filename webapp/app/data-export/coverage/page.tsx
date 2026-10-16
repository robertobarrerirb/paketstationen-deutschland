import CoverageClient from '@/components/coverage/CoverageClient';

export const metadata = {
  title: 'Abdeckung — Paketstationen Deutschland',
  description:
    'Anteil der Einwohner im gewählten Radius einer Abholstelle, je Netz und Art des Punkts, und dicht besiedelte Gebiete ohne Versorgung.',
};

export default function CoveragePage() {
  return <CoverageClient />;
}
