import type { Metadata } from 'next';
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'API — Paketstationen Deutschland',
  description: 'REST API for parcel pickup points in Germany, by Gemeinde, Kreis and Land',
};

export default function APIDocsPage() {
  const theme = JSON.stringify({
    colors: {
      primary: {
        main: '#2563eb',
      },
    },
    typography: {
      fontSize: '14px',
      fontFamily: 'Inter, system-ui, sans-serif',
    },
  });

  // Create the redoc element HTML string
  const redocHTML = `<redoc spec-url="/openapi.yaml" theme='${theme}' expand-responses="200" required-props-first="true"></redoc>`;

  return (
    <div style={{ margin: 0, height: '100vh' }}>
      <Script
        src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"
        strategy="afterInteractive"
      />
      <div dangerouslySetInnerHTML={{ __html: redocHTML }} />
    </div>
  );
}
