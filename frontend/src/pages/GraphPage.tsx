import { useState } from 'react';
import { NeuralGraph } from '../components/graph/NeuralGraph';
import { GraphToolbar, type NodeLens } from '../components/graph/GraphToolbar';
import { DetailDrawer, type DetailTarget } from '../components/drawer/DetailDrawer';

/**
 * 神经图主页（默认首页，04 §6.1）+ 工具条（透镜/漫游/主题）。
 */
export default function GraphPage(): JSX.Element {
  const [selected, setSelected] = useState<DetailTarget | null>(null);
  const [lens, setLens] = useState<NodeLens>('all');
  const [walk, setWalk] = useState(false);

  return (
    <div className="relative h-full w-full">
      <NeuralGraph onSelect={setSelected} lens={lens} walk={walk} />
      <GraphToolbar
        lens={lens}
        onLensChange={setLens}
        walk={walk}
        onWalkToggle={() => setWalk((v) => !v)}
      />
      <DetailDrawer target={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
