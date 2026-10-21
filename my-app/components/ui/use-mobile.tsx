import * as useReact from 'react'

const MOBILE_BREAKPOINT = 768

/** 媒体查询订阅器：把 matchMedia 的 change 事件桥接为 store 订阅 */
const subscribe = (callback: () => void) => {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

/**
 * 是否处于移动端视口（< 768px）。
 *
 * 【实现说明】
 * shadcn 原版用 useEffect + setState 同步媒体查询状态，会触发
 * react-hooks/set-state-in-effect（effect 体内同步 setState）。
 * useSyncExternalStore 是该场景的官方推荐形态：订阅外部系统
 * （matchMedia），快照函数直接回答「当前是否移动端」，零 setState。
 */
export function useIsMobile() {
  return useReact.useSyncExternalStore(
    subscribe,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false
  )
}
