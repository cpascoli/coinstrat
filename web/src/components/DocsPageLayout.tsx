import React from 'react';
import DocsSectionNav from './DocsSectionNav';

const DocsPageLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="dark mx-auto flex w-full max-w-[1600px] font-body text-on-surface">
      <aside className="hidden w-64 shrink-0 border-r border-outline-variant/15 bg-surface py-4 pl-2 pr-4 md:block">
        <div className="sticky top-16">
          <DocsSectionNav />
        </div>
      </aside>
      <main className="min-w-0 flex-1 bg-surface px-4 py-8 md:px-10 md:py-10">{children}</main>
    </div>
  );
};

export default DocsPageLayout;
