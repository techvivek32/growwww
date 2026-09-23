import { getIndices } from "@/lib/api/yahoo";
import LiveIndexStrip from "./LiveIndexStrip";

/**
 * The thin index ticker Groww puts under its nav. Rendered on the server with
 * the current levels, then kept moving client-side by LiveIndexStrip.
 */
export default async function IndexStrip() {
  const indices = await getIndices();

  return (
    <LiveIndexStrip
      rows={indices.map((ix) => ({
        symbol: ix.symbol,
        last: ix.last,
        change: ix.change,
        changePct: ix.changePct,
        stale: ix.stale === true,
        asOf: ix.asOf ?? null,
      }))}
    />
  );
}
