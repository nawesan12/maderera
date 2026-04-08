"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export interface BudgetItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  category: string;
  notes?: string;
}

interface BudgetContextType {
  items: BudgetItem[];
  addItem: (item: Omit<BudgetItem, "id">) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearBudget: () => void;
  totalItems: number;
}

const BudgetContext = createContext<BudgetContextType | undefined>(undefined);

export function BudgetProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<BudgetItem[]>([]);

  const addItem = (item: Omit<BudgetItem, "id">) => {
    const id = `${item.name}-${Date.now()}`;
    setItems((prev) => [...prev, { ...item, id }]);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const updateQuantity = (id: string, quantity: number) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, quantity } : item))
    );
  };

  const clearBudget = () => setItems([]);

  return (
    <BudgetContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        updateQuantity,
        clearBudget,
        totalItems: items.length,
      }}
    >
      {children}
    </BudgetContext.Provider>
  );
}

export function useBudget() {
  const context = useContext(BudgetContext);
  if (context === undefined) {
    throw new Error("useBudget must be used within a BudgetProvider");
  }
  return context;
}
