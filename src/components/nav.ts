import { createContext, useContext } from 'react';
import type { PageKey } from '../App';

/** 切換頁面，可附帶參數（例如要開啟的分頁）。 */
export type Go = (page: PageKey, arg?: string) => void;

export const NavArgContext = createContext('');

/** 讀取切換頁面時附帶的參數。 */
export const useNavArg = () => useContext(NavArgContext);
