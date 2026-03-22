import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DOCS_NAV_ITEMS } from './DocsSectionNav';

const DocsPager: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const { previousItem, nextItem } = useMemo(() => {
    const currentIndex = DOCS_NAV_ITEMS.findIndex((item) => item.path === location.pathname);

    if (currentIndex === -1) {
      return { previousItem: null, nextItem: null };
    }

    return {
      previousItem: currentIndex > 0 ? DOCS_NAV_ITEMS[currentIndex - 1] : null,
      nextItem: currentIndex < DOCS_NAV_ITEMS.length - 1 ? DOCS_NAV_ITEMS[currentIndex + 1] : null,
    };
  }, [location.pathname]);

  if (!previousItem && !nextItem) {
    return null;
  }

  return (
    <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low/80 p-6 backdrop-blur-sm">
      <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-on-surface-variant">Continue reading</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {previousItem && (
            <button
              type="button"
              onClick={() => navigate(previousItem.path)}
              className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/20 bg-surface-container-high px-4 py-2.5 text-sm font-bold text-on-surface transition-colors hover:bg-surface-container-highest"
            >
              <ChevronLeft size={16} />
              {previousItem.label}
            </button>
          )}
        </div>
        <div className="ml-auto">
          {nextItem && (
            <button
              type="button"
              onClick={() => navigate(nextItem.path)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-container px-4 py-2.5 text-sm font-bold text-on-primary-container transition-all hover:opacity-90"
            >
              {nextItem.label}
              <ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocsPager;
