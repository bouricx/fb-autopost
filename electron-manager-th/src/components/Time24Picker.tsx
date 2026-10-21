export function Time24Picker({ value, onChange }: { value: string; onChange(value: string): void }) {
  const [hour, minute] = value.split(":");
  return <div className="time24-picker"><select aria-label="ชั่วโมง (00 ถึง 23)" value={hour} onChange={e => onChange(`${e.target.value}:${minute}`)}>
    {Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0")).map(item => <option key={item} value={item}>{item}</option>)}
  </select><b>:</b><select aria-label="นาที (00 ถึง 59)" value={minute} onChange={e => onChange(`${hour}:${e.target.value}`)}>
    {Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0")).map(item => <option key={item} value={item}>{item}</option>)}
  </select></div>;
}
