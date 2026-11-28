import { useId, useRef } from 'react';
import type { ScenarioRequest } from './intelligence';

function denomination(minor: number, currency: string) {
  return currency + ' ' + (minor / 100).toLocaleString('en-HK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function ScenarioMonetaryAmounts({ scenario }: { scenario: ScenarioRequest }) {
  const amounts = [
    ['Value per conversion', scenario.value_per_conversion_minor],
    ['Advertising spend', scenario.advertising_spend_minor],
    ['Total campaign cost', scenario.campaign_cost_minor ?? scenario.spend_minor],
  ] as const;
  return (
    <dl className="rc-criteria">
      {amounts.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value == null ? 'Unspecified' : denomination(value, scenario.currency)}</dd>
        </div>
      ))}
    </dl>
  );
}

export type ScenarioChoice = 'saved' | 'accepted' | 'omitted';

export function ScenarioCurrencyReview({ scenario, currency, choice, campaignBudget, budgetCurrency, usesBriefDefault, onChoose }: {
  scenario: ScenarioRequest;
  currency: string;
  choice: ScenarioChoice;
  campaignBudget?: number;
  budgetCurrency: string;
  usesBriefDefault: boolean;
  onChoose: (choice: ScenarioChoice) => void;
}) {
  const title = useId();
  const region = useRef<HTMLElement>(null);
  const validCurrency = /^[A-Z]{3}$/.test(currency);

  function choose(next: ScenarioChoice) {
    region.current?.focus();
    onChoose(next);
  }

  return (
    <section className="rc-settings" aria-labelledby={title} tabIndex={-1} ref={region}>
      <h3 id={title}>Review saved scenario currency</h3>
      <p>Saved scenario currency {scenario.currency}. {validCurrency
        ? 'Campaign currency ' + currency + '.' : 'Enter a three-letter campaign currency.'}</p>
      {usesBriefDefault && <p>The saved brief has no evaluation currency. Its budget used the {budgetCurrency} research default.</p>}
      {campaignBudget != null && currency !== budgetCurrency && (
        <p>Original campaign budget {denomination(campaignBudget, budgetCurrency)}. Enter a budget in the current campaign currency.</p>
      )}
      <p><strong>Saved amounts</strong></p>
      <ScenarioMonetaryAmounts scenario={scenario} />
      <p role="status">
        {choice === 'saved' && 'Choose how to handle these saved amounts before previewing.'}
        {choice === 'accepted' && 'You chose ' + currency + ' for the scenario in this research. Edit the amounts under Outcome assumptions.'}
        {choice === 'omitted' && 'The saved scenario is excluded from this research.'}
      </p>
      {choice === 'saved' && validCurrency && (
        <p>Using the same amounts assigns them the campaign currency with no currency conversion.</p>
      )}
      <div className="rc-actions">
        {choice === 'saved' && validCurrency && (
          <button className="studio-secondary" type="button" onClick={() => choose('accepted')}>
            Use these same amounts in {currency}
          </button>
        )}
        {choice !== 'omitted' && (
          <button className="studio-secondary" type="button" onClick={() => choose('omitted')}>
            Leave scenario out of this research
          </button>
        )}
        {choice !== 'saved' && (
          <button className="studio-secondary" type="button" onClick={() => choose('saved')}>
            Restore saved {scenario.currency} assumptions
          </button>
        )}
      </div>
    </section>
  );
}
