import { TabSurface } from "../components/tab-surface";

// Home is one page of the Home ↔ Groups ↔ Activity pager (spliteco-calm SL2):
// the surface opens on this tab and keeps the address in step as it turns.
export default function HomePage() {
  return <TabSurface tab={0} />;
}
