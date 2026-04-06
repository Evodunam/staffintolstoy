import { 
  HardHat, Shovel, PaintBucket, Building2, Hammer, Zap, Droplets, Wind,
  Package, Truck, Warehouse, Users, ShoppingCart, ClipboardList, Store,
  Home, Sparkles, Wrench, PartyPopper, Utensils, Monitor, Volume2,
  Building, UserCog, Briefcase, HeartHandshake, Blocks, Layers
} from "lucide-react";

export interface IndustryRole {
  id: string;
  label: string;
  desc: string;
  icon: any;
  isElite?: boolean;
}

export interface IndustryCategory {
  id: string;
  label: string;
  icon: any;
  roles: IndustryRole[];
}

export const INDUSTRY_CATEGORIES: IndustryCategory[] = [
  {
    id: "construction",
    label: "Construction",
    icon: HardHat,
    roles: [
      { id: "Laborer", label: "Laborer", desc: "Furniture assembly, demolition, moving, general labor", icon: HardHat },
      { id: "Landscaping", label: "Landscaping", desc: "Lawn care, gardening, outdoor work", icon: Shovel },
      { id: "Painting", label: "Painting", desc: "Interior and exterior painting", icon: PaintBucket },
      { id: "Drywall", label: "Drywall", desc: "Hanging, mudding, and taping", icon: Layers },
      { id: "Concrete", label: "Concrete", desc: "Pouring, finishing, repairs", icon: Blocks },
      { id: "Carpentry Lite", label: "Carpentry Lite", desc: "Trim, tools, framing walls, small stairs", icon: Hammer },
      { id: "Carpentry Elite", label: "Carpentry Elite", desc: "Full structures, homes, complex builds", icon: Hammer, isElite: true },
      { id: "Electrical Lite", label: "Electrical Lite", desc: "Outlets, ceiling fans, replacing fixtures", icon: Zap },
      { id: "Electrical Elite", label: "Electrical Elite", desc: "Full home wiring, new installations", icon: Zap, isElite: true },
      { id: "Plumbing Lite", label: "Plumbing Lite", desc: "Faucets, toilets, repairs", icon: Droplets },
      { id: "Plumbing Elite", label: "Plumbing Elite", desc: "Full installs from scratch", icon: Droplets, isElite: true },
      { id: "HVAC Lite", label: "HVAC Lite", desc: "Repairs, existing systems", icon: Wind },
      { id: "HVAC Elite", label: "HVAC Elite", desc: "Full installs, ducting, minisplits, AC units", icon: Wind, isElite: true },
    ]
  },
  {
    id: "manufacturing_logistics",
    label: "Manufacturing & Logistics",
    icon: Package,
    roles: [
      { id: "Assembly Line Worker", label: "Assembly Line Worker", desc: "Production line assembly and manufacturing tasks", icon: Package },
      { id: "Forklift Operator", label: "Forklift Operator", desc: "Operate forklifts and material handling equipment", icon: Truck },
      { id: "Warehouse Associate", label: "Warehouse Associate", desc: "Picking, packing, inventory management", icon: Warehouse },
      { id: "Supply Chain Coordinator", label: "Supply Chain Coordinator", desc: "Coordinate logistics and supply chain operations", icon: ClipboardList },
    ]
  },
  {
    id: "retail",
    label: "Retail",
    icon: ShoppingCart,
    roles: [
      { id: "Sales Associate", label: "Sales Associate", desc: "Customer service, sales floor assistance", icon: ShoppingCart },
      { id: "Inventory Specialist", label: "Inventory Specialist", desc: "Stock management, inventory counts", icon: ClipboardList },
      { id: "Store Supervisor", label: "Store Supervisor", desc: "Team leadership, store operations management", icon: Store },
    ]
  },
  {
    id: "housekeeping",
    label: "Housekeeping",
    icon: Home,
    roles: [
      { id: "Housekeeper", label: "Housekeeper", desc: "Room cleaning, turnover services", icon: Home },
      { id: "Laundry Staff", label: "Laundry Staff", desc: "Laundry operations, linen management", icon: Sparkles },
      { id: "Janitorial Staff", label: "Janitorial Staff", desc: "Facility cleaning and maintenance", icon: Wrench },
    ]
  },
  {
    id: "event_planning",
    label: "Event Planning & Management",
    icon: PartyPopper,
    roles: [
      { id: "Event Coordinator", label: "Event Coordinator", desc: "Plan and coordinate events and functions", icon: PartyPopper },
      { id: "Banquet Server", label: "Banquet Server", desc: "Food and beverage service at events", icon: Utensils },
      { id: "Setup Crew", label: "Setup / Teardown Crew", desc: "Event setup, breakdown, equipment handling", icon: Package },
      { id: "AV Technician", label: "AV Technician", desc: "Audio-visual equipment setup and operation", icon: Volume2 },
    ]
  },
  {
    id: "management_admin",
    label: "Management & Administration",
    icon: Briefcase,
    roles: [
      { id: "Site Manager", label: "Hotel / Site Manager", desc: "Overall site and facility management", icon: Building },
      { id: "Supervisor", label: "Supervisor", desc: "Team supervision and coordination", icon: UserCog },
      { id: "Office Admin", label: "Office Admin", desc: "Administrative support, scheduling, documentation", icon: Briefcase },
      { id: "HR Coordinator", label: "HR Coordinator", desc: "Human resources support and coordination", icon: HeartHandshake },
    ]
  }
];

export function getRolesByIndustry(industryId: string): IndustryRole[] {
  const industry = INDUSTRY_CATEGORIES.find(cat => cat.id === industryId);
  return industry?.roles || [];
}

export function getAllRoles(): IndustryRole[] {
  return INDUSTRY_CATEGORIES.flatMap(cat => cat.roles);
}

export function getIndustryByRoleId(roleId: string): IndustryCategory | undefined {
  return INDUSTRY_CATEGORIES.find(cat => cat.roles.some(role => role.id === roleId));
}

/** Lite/Elite pairs: only one of each pair can be selected. Returns the other role id in the pair, or null. */
const LITE_ELITE_PAIRS: [string, string][] = [
  ["Carpentry Lite", "Carpentry Elite"],
  ["Electrical Lite", "Electrical Elite"],
  ["Plumbing Lite", "Plumbing Elite"],
  ["HVAC Lite", "HVAC Elite"],
];

export function getLiteElitePartner(roleId: string): string | null {
  for (const [a, b] of LITE_ELITE_PAIRS) {
    if (roleId === a) return b;
    if (roleId === b) return a;
  }
  return null;
}

export function getRolesCommaSeparated(industryId: string): string {
  const roles = getRolesByIndustry(industryId);
  return roles.map(r => r.label).join(", ");
}
