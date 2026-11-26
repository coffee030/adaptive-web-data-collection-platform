import type { ScenarioRequest } from './intelligence';

export function readScenario(form: HTMLFormElement): ScenarioRequest {
  const values = new FormData(form);
  function numeric(name: string) {
    const value = String(values.get(name) ?? '');
    return value ? Number(value) : undefined;
  }
  function share(name: string) {
    const value = numeric(name);
    return value === undefined ? undefined : (value / 100).toFixed(6);
  }
  function minor(name: string) {
    const value = numeric(name);
    return value === undefined ? undefined : Math.round(value * 100);
  }
  return {
    currency: 'HKD',
    impressions: numeric('impressions'),
    click_rate: share('clicks'),
    conversion_rate: share('conversions'),
    value_per_conversion_minor: minor('value'),
    advertising_spend_minor: minor('ads'),
    campaign_cost_minor: minor('cost'),
    contribution_margin: share('margin'),
  };
}

export function ScenarioFields({ input }: { input?: ScenarioRequest | null }) {
  function initial(value: string | number | undefined, scale = 1) {
    return value == null ? undefined : Number((Number(value) * scale).toFixed(6));
  }
  return (
    <>
      <label>
        Impressions
        <input
          type="number"
          name="impressions"
          defaultValue={initial(input?.impressions)}
          min={0}
          max={1000000000000}
        />
      </label>
      <label>
        Click rate (%)
        <input
          type="number"
          name="clicks"
          defaultValue={initial(input?.click_rate, 100)}
          min={0}
          max={100}
          step={0.0001}
        />
      </label>
      <label>
        Conversion rate (%)
        <input
          type="number"
          name="conversions"
          defaultValue={initial(input?.conversion_rate, 100)}
          min={0}
          max={100}
          step={0.0001}
        />
      </label>
      <label>
        Value per conversion (HK$)
        <input
          type="number"
          name="value"
          defaultValue={initial(input?.value_per_conversion_minor, 0.01)}
          min={0}
          max={10000000}
          step={0.01}
        />
      </label>
      <label>
        Advertising spend (HK$)
        <input
          type="number"
          name="ads"
          defaultValue={initial(input?.advertising_spend_minor, 0.01)}
          min={0}
          max={10000000}
          step={0.01}
        />
      </label>
      <label>
        Total campaign cost (HK$)
        <input
          type="number"
          name="cost"
          defaultValue={initial(input?.campaign_cost_minor, 0.01)}
          min={0}
          max={10000000}
          step={0.01}
        />
      </label>
      <label>
        Contribution margin (%)
        <input
          type="number"
          name="margin"
          defaultValue={initial(input?.contribution_margin, 100)}
          min={0}
          max={100}
          step={0.0001}
        />
      </label>
    </>
  );
}
