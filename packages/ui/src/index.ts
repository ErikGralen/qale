/**
 * @qale/ui barrel — the renderer-only presentation kit. Re-exports the common
 * primitives plus shared helpers. Individual components are also reachable via
 * granular subpaths (`@qale/ui/ui/button`) for tree-shaking.
 */
export { cn } from './lib/utils';
export { ThemeProvider, useTheme } from './components/theme-provider';
export { Logo } from './components/logo';

export { Button, buttonVariants } from './components/ui/button';
export { Badge } from './components/ui/badge';
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from './components/ui/card';
export { Input } from './components/ui/input';
export { Textarea } from './components/ui/textarea';
export { ScrollArea } from './components/ui/scroll-area';
export { Separator } from './components/ui/separator';
export { Spinner } from './components/ui/spinner';
export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './components/ui/dialog';
export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from './components/ui/command';
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './components/ui/tooltip';
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from './components/ui/dropdown-menu';
export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent } from './components/ui/popover';
export { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs';
export {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from './components/ui/resizable';
export { Collapsible, CollapsibleTrigger, CollapsibleContent } from './components/ui/collapsible';
export { Empty } from './components/ui/empty';
export { Item } from './components/ui/item';
