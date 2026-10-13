import '../cabinet-flows.css';

export function CabinetSteps({ labels, current, onSelect, disabled = false }: { labels: string[]; current: number; onSelect?: (index: number) => void; disabled?: boolean }) {
  return <nav className="cabinet-steps" aria-label="Шаги формы"><ol>{labels.map((label, index) => <li key={label} className={index === current ? 'is-current' : index < current ? 'is-complete' : ''} aria-current={index === current ? 'step' : undefined}>
    {onSelect ? <button type="button" disabled={disabled || index > current} onClick={() => onSelect(index)}><span aria-hidden="true">{index + 1}</span>{label}</button> : <span className="cabinet-step-label"><span aria-hidden="true">{index + 1}</span>{label}</span>}
  </li>)}</ol><p className="cabinet-step-count" aria-live="polite">Шаг {current + 1} из {labels.length}: {labels[current]}</p></nav>;
}
