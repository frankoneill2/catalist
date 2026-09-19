import React from 'react';

interface ShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const Shell: React.FC<ShellProps> = ({ title, subtitle, children, footer }) => (
  <div className="ag-shell">
    <div className="ag-card" role="dialog" aria-labelledby="ag-title">
      <header className="ag-header">
        <div className="ag-brand">
          <span className="ag-brand-name">wardround.app</span>
          <span className="ag-brand-sub">Clinical notes &amp; tasks</span>
        </div>
        <h1 id="ag-title" className="ag-title">{title}</h1>
        {subtitle ? <p className="ag-subtitle">{subtitle}</p> : null}
      </header>
      <div className="ag-body">{children}</div>
      {footer ? <footer className="ag-footer">{footer}</footer> : null}
    </div>
  </div>
);

interface FormErrorProps { children?: React.ReactNode }
export const FormError: React.FC<FormErrorProps> = ({ children }) =>
  children ? <p className="ag-error" role="alert">{children}</p> : null;

interface InfoProps { children?: React.ReactNode }
export const Info: React.FC<InfoProps> = ({ children }) =>
  children ? <p className="ag-info">{children}</p> : null;
