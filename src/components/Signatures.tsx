import { signatureRows } from '../lib/statement';
import { useStore } from '../store';

/** 報表簽章欄：每行一個表格，上方為職稱、下方留白簽名。 */
export default function Signatures() {
  const { data } = useStore();
  const rows = signatureRows(data.settings.signatures);
  if (rows.length === 0) return null;
  return (
    <div className="signatures">
      {rows.map((row, i) => (
        <table className="sig-table" key={i}>
          <thead>
            <tr>{row.map((s) => <th key={s.id}>{s.label}</th>)}</tr>
          </thead>
          <tbody>
            <tr>{row.map((s) => <td key={s.id} />)}</tr>
          </tbody>
        </table>
      ))}
    </div>
  );
}
