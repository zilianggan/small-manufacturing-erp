import React from 'react';
import { Sheet } from '../ui/Sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/Tabs';

export interface SlideOverFormTab {
  value: string;
  label: string;
  content: React.ReactNode;
}

interface SlideOverFormProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  tabs: SlideOverFormTab[];
  activeTab: string;
  onTabChange: (value: string) => void;
  footer?: React.ReactNode;
  width?: string;
}

/** Tabbed record editor drawer (Sheet + Tabs) — replaces modal-based add/edit forms so the list/detail stays on screen. */
export function SlideOverForm({ open, onClose, title, description, tabs, activeTab, onTabChange, footer, width }: SlideOverFormProps) {
  return (
    <Sheet open={open} onClose={onClose} title={title} description={description} width={width} footer={footer}>
      <Tabs value={activeTab} onValueChange={onTabChange} className="p-5">
        <TabsList className="w-full grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>{tab.content}</TabsContent>
        ))}
      </Tabs>
    </Sheet>
  );
}
