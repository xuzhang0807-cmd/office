import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const idRef = useRef(0);

  const push = useCallback((message, type = 'info', ttl = 3600) => {
    idRef.current += 1;
    const id = idRef.current;
    setItems((list) => [...list, { id, message: String(message), type }]);
    setTimeout(() => setItems((list) => list.filter((item) => item.id !== id)), ttl);
  }, []);

  const value = useMemo(
    () => ({
      info: (m) => push(m, 'info'),
      success: (m) => push(m, 'success'),
      error: (m) => push(m, 'error', 5200),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-wrap">
        {items.map((item) => (
          <div key={item.id} className={`toast ${item.type}`}>
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用');
  return ctx;
}
