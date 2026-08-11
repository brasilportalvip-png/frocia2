import React from 'react';

export const ChatSkeleton: React.FC = () => {
  return (
    <div className="space-y-6 animate-pulse p-4 max-w-3xl mx-auto">
      <div className="flex gap-4 items-start">
        <div className="w-10 h-10 rounded-full bg-white/10 shrink-0" />
        <div className="space-y-2 flex-1">
          <div className="h-4 bg-white/10 rounded w-1/4" />
          <div className="h-16 bg-white/5 rounded-2xl w-full" />
        </div>
      </div>

      <div className="flex gap-4 items-start flex-row-reverse">
        <div className="w-8 h-8 rounded-full bg-amber-400/20 shrink-0" />
        <div className="space-y-2 max-w-[70%]">
          <div className="h-12 bg-white/10 rounded-2xl w-full" />
        </div>
      </div>

      <div className="flex gap-4 items-start">
        <div className="w-10 h-10 rounded-full bg-white/10 shrink-0" />
        <div className="space-y-2 flex-1">
          <div className="h-4 bg-white/10 rounded w-1/3" />
          <div className="h-28 bg-white/5 rounded-2xl w-full" />
        </div>
      </div>
    </div>
  );
};

export const ProjectCardSkeleton: React.FC = () => {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 space-y-4 animate-pulse">
      <div className="h-32 rounded-2xl bg-white/10 w-full" />
      <div className="space-y-2">
        <div className="h-5 bg-white/15 rounded w-3/4" />
        <div className="h-3 bg-white/10 rounded w-1/2" />
      </div>
      <div className="flex justify-between items-center pt-2">
        <div className="h-4 bg-white/10 rounded w-20" />
        <div className="h-8 bg-amber-400/20 rounded-xl w-24" />
      </div>
    </div>
  );
};

export const DashboardProfileSkeleton: React.FC = () => {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 space-y-6 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-full bg-white/10 shrink-0" />
        <div className="space-y-2 flex-1">
          <div className="h-6 bg-white/15 rounded w-1/3" />
          <div className="h-4 bg-white/10 rounded w-1/2" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="h-20 rounded-2xl bg-white/5" />
        <div className="h-20 rounded-2xl bg-white/5" />
        <div className="h-20 rounded-2xl bg-white/5" />
      </div>
    </div>
  );
};
