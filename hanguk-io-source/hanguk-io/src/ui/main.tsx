import { createRoot } from 'react-dom/client';
import contentJson from '../generated/content.json';
import { ContentModel, decodeContent } from '../core/content';
import { App } from './App';
import { OceanScene } from './art/ocean';

const model = new ContentModel(decodeContent(contentJson));

let scene: OceanScene | null = null;
const canvas = document.getElementById('ocean') as HTMLCanvasElement | null;
if (canvas) {
  try {
    scene = new OceanScene(canvas);
    scene.start();
    const s = scene;
    window.addEventListener('resize', () => s.resize());
    document.addEventListener('visibilitychange', () => (document.hidden ? s.stop() : s.start()));
  } catch {
    scene = null; // the game works without the backdrop
  }
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App model={model} scene={scene} />);
