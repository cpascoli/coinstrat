import React from 'react';
import clsx from 'clsx';
import { Link, useNavigate } from 'react-router-dom';
import DocsPageLayout from '../components/DocsPageLayout';
import DocsPager from '../components/DocsPager';

const DocsHome: React.FC = () => {
  const navigate = useNavigate();

  return (
    <DocsPageLayout>
      <div className="mx-auto max-w-6xl">
        <header className="relative mb-12 md:mb-16">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div className="space-y-4">
              <span className="text-xs font-bold uppercase tracking-[0.3em] text-secondary">Knowledge base</span>
              <h1 className="font-headline text-4xl font-extrabold tracking-tighter text-on-surface md:text-5xl lg:text-6xl">
                CoinStrat <span className="text-primary">Docs</span>
              </h1>
              <p className="max-w-xl font-body text-lg leading-relaxed text-on-surface-variant">
                Reference material for CoinStrat. Understand the external data feeds behind the model, and see how the signal
                engine is assembled.
              </p>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
          <section className="group relative overflow-hidden rounded-xl border border-outline-variant/10 bg-surface-container p-8 transition-all duration-300 hover:border-primary/30 md:col-span-8">
            <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />
            <div className="relative z-10 flex h-full flex-col justify-between">
              <div>
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-lg bg-primary-container/20">
                  <span className="material-symbols-outlined text-3xl text-primary">architecture</span>
                </div>
                <h2 className="font-headline mb-4 text-3xl font-bold text-on-surface">Architecture</h2>
                <p className="mb-8 max-w-lg leading-relaxed text-on-surface-variant">
                  The full CoinStrat pipeline from raw time series, to engineered metrics, to scores, to stateful signals and
                  final portfolio permission.
                </p>
              </div>
              <Link
                to="/docs/architecture"
                className="group/link inline-flex items-center gap-2 font-bold text-primary"
              >
                Open Architecture
                <span className="material-symbols-outlined text-xl transition-transform group-hover/link:translate-x-1">
                  arrow_forward
                </span>
              </Link>
            </div>
            <div className="pointer-events-none absolute bottom-0 right-0 p-4 opacity-10">
              <div className="grid grid-cols-4 gap-2">
                <div className="h-12 w-8 rounded-sm bg-primary" />
                <div className="h-24 w-8 rounded-sm bg-primary" />
                <div className="h-16 w-8 rounded-sm bg-primary" />
                <div className="h-20 w-8 rounded-sm bg-primary" />
              </div>
            </div>
          </section>

          <DocTile
            className="md:col-span-4"
            icon="database"
            iconClass="bg-secondary/10 text-secondary"
            accentHover="hover:border-secondary/30"
            title="Data Feeds"
            text="All third-party data series used to compute liquidity, valuation, trend, and business-cycle signals."
            to="/docs/data"
            linkLabel="View Data Feeds"
            linkClass="text-secondary"
            chevron
          />

          <DocTile
            className="md:col-span-4"
            icon="query_stats"
            iconClass="bg-primary/10 text-primary"
            accentHover="hover:border-primary/30"
            title="Scores"
            text="Definitions, formulas, thresholds, and rationale for valuation, liquidity, cycle, and dollar-regime scoring."
            to="/docs/scores"
            linkLabel="Open Scores Docs"
            linkClass="text-primary"
            chevron
          />

          <DocTile
            className="md:col-span-4"
            icon="verified_user"
            iconClass="bg-tertiary/10 text-tertiary"
            accentHover="hover:border-tertiary/30"
            title="Signals"
            text="How the Core Engine, Macro Accelerator, and final accumulation permission are synthesized from the factor scores."
            to="/docs/signals"
            linkLabel="Open Signals Docs"
            linkClass="text-tertiary"
            chevron
          />

          <section
            className={clsx(
              'relative flex flex-col justify-between overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-high p-8 md:col-span-4',
            )}
          >
            <div className="absolute right-0 top-0 h-32 w-32 bg-secondary/10 blur-[60px]" />
            <div className="relative z-10">
              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-lg bg-secondary-container/20">
                <span className="material-symbols-outlined text-3xl text-secondary">construction</span>
              </div>
              <h2 className="font-headline mb-3 text-2xl font-bold text-on-surface">Signal Builder</h2>
              <p className="mb-8 text-sm leading-relaxed text-on-surface-variant">
                Build custom strategies in plain English. Learn about the available series, metric operators, comparators, and
                see example prompts.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/docs/signal-builder')}
              className="relative z-10 w-full rounded-lg bg-secondary py-3 font-bold text-on-secondary shadow-lg shadow-secondary/20 transition-all hover:scale-[1.02] active:scale-95"
            >
              Open Signal Builder Docs
            </button>
          </section>

          <div className="md:col-span-12">
            <div className="glass-panel rounded-2xl border border-outline-variant/10 p-1">
              <div className="flex flex-col items-center justify-between gap-8 rounded-xl bg-surface-container-lowest p-8 md:flex-row">
                <div className="flex flex-col items-center gap-6 sm:flex-row">
                  <div className="hidden sm:block">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full border border-outline-variant/20 bg-surface-container">
                      <span className="material-symbols-outlined text-3xl text-primary">code</span>
                    </div>
                  </div>
                  <div className="text-center sm:text-left">
                    <h3 className="font-headline text-xl font-bold text-on-surface">Developer API</h3>
                    <p className="text-on-surface-variant">HTTP reference, examples, and authentication for the CoinStrat API.</p>
                  </div>
                </div>
                <Link
                  to="/developer"
                  className="rounded-lg bg-primary px-6 py-2.5 font-bold text-on-primary shadow-lg shadow-primary/20 transition-all hover:opacity-90"
                >
                  Open Developer Docs
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12">
          <DocsPager />
        </div>
      </div>
    </DocsPageLayout>
  );
};

function DocTile({
  className,
  icon,
  iconClass,
  accentHover,
  title,
  text,
  to,
  linkLabel,
  linkClass,
  chevron,
}: {
  className?: string;
  icon: string;
  iconClass: string;
  accentHover: string;
  title: string;
  text: string;
  to: string;
  linkLabel: string;
  linkClass: string;
  chevron?: boolean;
}) {
  return (
    <section
      className={clsx(
        'rounded-xl border border-outline-variant/10 bg-surface-container p-8 transition-all duration-300',
        accentHover,
        className,
      )}
    >
      <div className={clsx('mb-6 flex h-12 w-12 items-center justify-center rounded-lg', iconClass)}>
        <span className="material-symbols-outlined text-3xl">{icon}</span>
      </div>
      <h2 className="font-headline mb-3 text-2xl font-bold text-on-surface">{title}</h2>
      <p className="mb-6 text-sm leading-relaxed text-on-surface-variant">{text}</p>
      <Link to={to} className={clsx('inline-flex items-center gap-1 text-sm font-bold group', linkClass)}>
        {linkLabel}
        {chevron ? (
          <span className="material-symbols-outlined text-base transition-transform group-hover:translate-x-1">chevron_right</span>
        ) : null}
      </Link>
    </section>
  );
}

export default DocsHome;
