import type { Metadata } from "next";

import OverviewPage from "./overview-page";

/** `/`: its canonical address, as every public page states its own (the page itself is a client component). */
export const metadata: Metadata = { alternates: { canonical: "/" } };

export default OverviewPage;
