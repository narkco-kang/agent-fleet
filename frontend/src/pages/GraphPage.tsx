import { useState } from 'react';
import { NeuralGraph } from '../components/graph/NeuralGraph';
import { DetailDrawer, type DetailTarget } from '../components/drawer/DetailDrawer';

/**
 * 神经图主页（默认首页，04 §6.1）。
 */
export default function GraphPage(): JSX.Element {
  const [selected, setSelected] = useState<DetailTarget | null>(null);

  return (
    <div className="relative h-full w-full">
      <NeuralGraph onSelect={setSelected} />
      <DetailDrawer target={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
