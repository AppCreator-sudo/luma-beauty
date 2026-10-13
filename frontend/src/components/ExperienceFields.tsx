import { useId, useState } from 'react';
export function experienceText(months?: number | null) {
  if (months == null) return '';
  const plural = (n: number, words: string[]) => words[n % 100 >= 11 && n % 100 <= 14 ? 2 : n % 10 === 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 ? 1 : 2];
  const years = Math.floor(months / 12), rest = months % 12;
  return [years ? `${years} ${plural(years, ['год', 'года', 'лет'])}` : '', rest || !years ? `${rest} ${plural(rest, ['месяц', 'месяца', 'месяцев'])}` : ''].filter(Boolean).join(' ');
}
export function ExperienceFields({ value, onChange, onValidationChange }: { value: number | null; onChange: (value: number | null) => void; onValidationChange: (error: string) => void }) {
  const id = useId();
  const [years, setYears] = useState(value == null ? '' : String(Math.floor(value / 12)));
  const [months, setMonths] = useState(value == null ? '' : String(value % 12));
  const [error, setError] = useState('');
  function change(nextYears: string, nextMonths: string) {
    setYears(nextYears); setMonths(nextMonths);
    const valid = (raw: string, max: number) => raw === '' || /^\d+$/.test(raw) && Number(raw) <= max;
    const problem = !valid(nextYears, 99) || !valid(nextMonths, 11) ? 'Укажите целые годы от 0 до 99 и месяцы от 0 до 11.' : '';
    setError(problem); onValidationChange(problem);
    if (!problem) onChange(nextYears === '' && nextMonths === '' ? null : Number(nextYears) * 12 + Number(nextMonths));
  }
  return <fieldset className="experience-fields"><legend>Профессиональный стаж</legend><div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,130px))', gap: 12 }}><label>Лет<input type="number" min={0} max={99} step={1} inputMode="numeric" value={years} aria-invalid={Boolean(error)} aria-describedby={id} onChange={e => change(e.target.value, months)}/></label><label>Месяцев<input type="number" min={0} max={11} step={1} inputMode="numeric" value={months} aria-invalid={Boolean(error)} aria-describedby={id} onChange={e => change(years, e.target.value)}/></label></div><small id={id}>{error || 'Необязательно. Оставьте пустым, если пока не хотите указывать стаж.'}</small></fieldset>;
}
