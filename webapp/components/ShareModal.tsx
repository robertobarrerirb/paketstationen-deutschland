'use client';

import { useState, useEffect, useRef } from 'react';
import { slugToUrl } from '@/lib/territory';
import { useI18n } from '@/lib/i18n';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  municipality: string;
  municipalityName: string;
}

export default function ShareModal({ isOpen, onClose, municipality, municipalityName }: ShareModalProps) {
  const { t, lang } = useI18n();
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  const [embedWidth, setEmbedWidth] = useState('100%');
  const [embedHeight, setEmbedHeight] = useState('500');
  const modalRef = useRef<HTMLDivElement>(null);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const urlSlug = slugToUrl(municipality);
  const shareUrl = `${baseUrl}/?gemeinde=${urlSlug}&lang=${lang}`;
  const embedUrl = `${baseUrl}/embed?gemeinde=${urlSlug}&lang=${lang}`;
  const embedCode = `<iframe src="${embedUrl}" width="${embedWidth}" height="${embedHeight}" style="border:none;border-radius:8px;" loading="lazy" allowfullscreen></iframe>`;

  useEffect(() => {
    if (!isOpen) {
      setCopiedLink(false);
      setCopiedEmbed(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const copyToClipboard = async (text: string, type: 'link' | 'embed') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'link') {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      } else {
        setCopiedEmbed(true);
        setTimeout(() => setCopiedEmbed(false), 2000);
      }
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      if (type === 'link') {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      } else {
        setCopiedEmbed(true);
        setTimeout(() => setCopiedEmbed(false), 2000);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        ref={modalRef}
        className="bg-card rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">{t('share.title')}</h2>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-1.5 text-subtle-foreground hover:text-muted-foreground hover:bg-secondary rounded-lg transition"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
              {/* Share link */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                  {t('share.directLink', { name: municipalityName })}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    className="flex-1 px-3 py-2 text-sm bg-muted border border-input rounded-lg text-muted-foreground font-mono select-all"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    onClick={() => copyToClipboard(shareUrl, 'link')}
                    className={`px-3 py-2 text-sm font-medium rounded-lg transition whitespace-nowrap ${
                      copiedLink
                        ? 'bg-success-muted text-success'
                        : 'bg-primary text-white hover:bg-primary/90'
                    }`}
                  >
                    {copiedLink ? t('share.copied') : t('share.copy')}
                  </button>
                </div>
              </div>

              {/* Embed code */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                  {t('share.embedCode')}
                </label>
                <p className="text-xs text-subtle-foreground mb-2">
                  {t('share.embedHint', { name: municipalityName })} {t('share.linkLanguage')}
                </p>

                {/* Size controls */}
                <div className="flex gap-3 mb-2">
                  <div className="flex-1">
                    <label className="block text-xs text-subtle-foreground mb-1">{t('share.width')}</label>
                    <select
                      value={embedWidth}
                      onChange={(e) => setEmbedWidth(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm text-foreground border border-input rounded-lg bg-card"
                    >
                      <option value="100%">100%</option>
                      <option value="800">800px</option>
                      <option value="600">600px</option>
                      <option value="400">400px</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-subtle-foreground mb-1">{t('share.height')}</label>
                    <select
                      value={embedHeight}
                      onChange={(e) => setEmbedHeight(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm text-foreground border border-input rounded-lg bg-card"
                    >
                      <option value="400">400px</option>
                      <option value="500">500px</option>
                      <option value="600">600px</option>
                      <option value="800">800px</option>
                    </select>
                  </div>
                </div>

                <div className="relative">
                  <pre className="px-3 py-2 text-xs bg-muted border border-input rounded-lg text-muted-foreground font-mono overflow-x-auto whitespace-pre-wrap break-all">
                    {embedCode}
                  </pre>
                  <button
                    onClick={() => copyToClipboard(embedCode, 'embed')}
                    className={`absolute top-2 right-2 px-2 py-1 text-xs font-medium rounded transition ${
                      copiedEmbed
                        ? 'bg-success-muted text-success'
                        : 'bg-card text-muted-foreground border border-input hover:bg-muted'
                    }`}
                  >
                    {copiedEmbed ? t('share.copied') : t('share.copy')}
                  </button>
                </div>
              </div>

              {/* Preview */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                  {t('share.preview')}
                </label>
                <div className="border border-border rounded-lg overflow-hidden bg-secondary" style={{ height: '250px' }}>
                  <iframe
                    src={embedUrl}
                    width="100%"
                    height="100%"
                    style={{ border: 'none' }}
                    loading="lazy"
                    title={`${t('app.title')} · ${municipalityName}`}
                  />
                </div>
              </div>
        </div>
      </div>
    </div>
  );
}
