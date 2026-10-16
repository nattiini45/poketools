"use client";

import CollapsibleSection from '@/components/ui/CollapsibleSection';

interface ProfileSectionProps {
  title: string;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}

/**
 * Profile sections are the shared collapsible Section primitive — one
 * heading/collapse grammar app-wide. The descendant overrides strip nested
 * card chrome so composed gamification panels sit flat inside the section.
 */
export default function ProfileSection({
  title,
  children,
  defaultCollapsed = false,
}: ProfileSectionProps) {
  return (
    <CollapsibleSection title={title} defaultCollapsed={defaultCollapsed}>
      <div className="[&>div]:bg-transparent [&>div]:border-0 [&>div]:shadow-none [&>div]:p-0 [&>div]:rounded-none [&>section]:bg-transparent [&>section]:border-0 [&>section]:shadow-none [&>section]:p-0 [&>section]:rounded-none">
        {children}
      </div>
    </CollapsibleSection>
  );
}
