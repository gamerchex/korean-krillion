// Minimal React typings. The offline build environment has React 19 but no @types/react,
// so the UI is type-checked against this small, deliberately loose surface. Replace with
// @types/react (npm i -D @types/react @types/react-dom) when the registry is reachable.

declare module 'react' {
  export type ReactNode = any;
  export type Key = string | number;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export interface MutableRefObject<T> {
    current: T;
  }
  export type RefObject<T> = MutableRefObject<T>;
  export type CSSProperties = Record<string, string | number | undefined>;
  export type FC<P = Record<string, unknown>> = (props: P & { children?: ReactNode; key?: Key }) => ReactNode;
  export interface SyntheticEvent<T = Element> {
    target: any;
    currentTarget: T & any;
    preventDefault(): void;
    stopPropagation(): void;
    nativeEvent: any;
  }
  export interface KeyboardEvent<T = Element> extends SyntheticEvent<T> {
    key: string;
    code: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    repeat: boolean;
  }
  export interface FormEvent<T = Element> extends SyntheticEvent<T> {}
  export interface ChangeEvent<T = Element> extends SyntheticEvent<T> {}
  export interface MouseEvent<T = Element> extends SyntheticEvent<T> {
    clientX: number;
    clientY: number;
  }
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useReducer<S, A>(reducer: (s: S, a: A) => S, initial: S): [S, Dispatch<A>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useRef<T>(initial: T): MutableRefObject<T>;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: any[]) => any>(fn: T, deps: readonly unknown[]): T;
  export function useId(): string;
  export function memo<T>(component: T): T;
  export function createContext<T>(value: T): { Provider: any; Consumer: any; _v?: T };
  export function useContext<T>(ctx: { _v?: T }): T;
  export const Fragment: any;
  export const StrictMode: any;
  const React: {
    Fragment: any;
    StrictMode: any;
  };
  export default React;
}

declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
  export namespace JSX {
    type Element = any;
    interface IntrinsicElements {
      [name: string]: any;
    }
    interface ElementChildrenAttribute {
      children: unknown;
    }
    interface IntrinsicAttributes {
      key?: string | number;
    }
  }
}

declare module 'react-dom/client' {
  export function createRoot(container: Element): { render(node: unknown): void; unmount(): void };
}
