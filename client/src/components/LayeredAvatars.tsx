import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface AvatarInfo {
  id: number | "self";
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
}

interface LayeredAvatarsProps {
  avatars: AvatarInfo[];
  size?: "sm" | "md" | "lg";
  maxDisplay?: number;
  className?: string;
}

const sizeClasses = {
  sm: "w-6 h-6 text-xs",
  md: "w-8 h-8 text-xs",
  lg: "w-10 h-10 text-sm",
};

const overlapClasses = {
  sm: "-space-x-2",
  md: "-space-x-2",
  lg: "-space-x-3",
};

export function LayeredAvatars({
  avatars,
  size = "md",
  maxDisplay = 4,
  className = "",
}: LayeredAvatarsProps) {
  const displayAvatars = avatars.slice(0, maxDisplay);
  const overflow = avatars.length - maxDisplay;

  if (avatars.length === 0) return null;

  const getInitials = (firstName?: string | null, lastName?: string | null) => {
    const first = firstName?.[0] || '';
    const last = lastName?.[0] || '';
    return first || last ? `${first}${last}` : '?';
  };

  return (
    <div className={`flex ${overlapClasses[size]} ${className}`}>
      {displayAvatars.map((avatar, index) => (
        <Avatar
          key={avatar.id}
          className={`${sizeClasses[size]} border-2 border-background ring-0`}
          style={{ zIndex: displayAvatars.length - index }}
        >
          <AvatarImage src={avatar.avatarUrl || undefined} />
          <AvatarFallback className="bg-primary text-primary-foreground">
            {getInitials(avatar.firstName, avatar.lastName)}
          </AvatarFallback>
        </Avatar>
      ))}
      {overflow > 0 && (
        <div
          className={`${sizeClasses[size]} rounded-full bg-muted border-2 border-background flex items-center justify-center font-medium`}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
