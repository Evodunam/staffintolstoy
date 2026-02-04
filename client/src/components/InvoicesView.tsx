import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { FileText, Download, Eye, Calendar, DollarSign, Clock, CheckCircle, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface Invoice {
  id: number;
  invoiceNumber: string;
  companyId: number;
  workerId: number;
  jobId: number | null;
  issueDate: string;
  dueDate: string;
  paidAt: string | null;
  subtotal: number;
  platformFee: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number;
  status: "draft" | "sent" | "paid" | "overdue" | "cancelled" | "void";
  paymentMethod: string | null;
  paymentReference: string | null;
  notes: string | null;
  createdAt: string;
}

interface InvoiceItem {
  id: number;
  invoiceId: number;
  description: string;
  quantity: string;
  unitPrice: number;
  amount: number;
  timesheetId: number | null;
  workDate: string | null;
}

interface InvoiceWithDetails extends Invoice {
  items: InvoiceItem[];
  company: { id: number; companyName: string | null; email: string | null } | null;
  worker: { id: number; fullName: string; email: string | null } | null;
  job: { id: number; title: string } | null;
}

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  overdue: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  cancelled: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  void: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

const statusIcons: Record<string, typeof CheckCircle> = {
  draft: Clock,
  sent: FileText,
  paid: CheckCircle,
  overdue: AlertCircle,
  cancelled: AlertCircle,
  void: AlertCircle,
};

export default function InvoicesView() {
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceWithDetails | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  const { data: invoiceDetails, isLoading: isLoadingDetails } = useQuery<InvoiceWithDetails>({
    queryKey: ["/api/invoices", selectedInvoice?.id],
    enabled: !!selectedInvoice?.id && viewDialogOpen,
  });

  const markPaidMutation = useMutation({
    mutationFn: async (invoiceId: number) => {
      return await apiRequest("PATCH", `/api/invoices/${invoiceId}`, { status: "paid" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setViewDialogOpen(false);
    },
  });

  const handleViewInvoice = (invoice: Invoice) => {
    setSelectedInvoice(invoice as InvoiceWithDetails);
    setViewDialogOpen(true);
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  const handleDownload = (invoice: Invoice) => {
    const invoiceData = `
INVOICE
=====================================
Invoice #: ${invoice.invoiceNumber}
Issue Date: ${format(new Date(invoice.issueDate), "MMMM d, yyyy")}
Due Date: ${format(new Date(invoice.dueDate), "MMMM d, yyyy")}
Status: ${invoice.status.toUpperCase()}

-------------------------------------
BILLING FROM:
Tolstoy Staffing
123 Market St, San Francisco, CA 94102
billing@tolstoy.com

-------------------------------------
SUMMARY
-------------------------------------
Subtotal: ${formatCurrency(invoice.subtotal)}
Platform Fee ($13/hr): ${formatCurrency(invoice.platformFee)}
Tax: ${formatCurrency(invoice.taxAmount)}
-------------------------------------
TOTAL: ${formatCurrency(invoice.totalAmount)}

${invoice.notes ? `Notes: ${invoice.notes}` : ''}
=====================================
    `.trim();

    const blob = new Blob([invoiceData], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${invoice.invoiceNumber}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (invoices.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <FileText className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No Invoices Yet</h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Invoices are automatically generated when timesheets are approved.
            Once you approve a worker's timesheet, an invoice will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4">
        {invoices.map((invoice) => {
          const StatusIcon = statusIcons[invoice.status] || FileText;
          
          return (
            <Card key={invoice.id} className="hover-elevate" data-testid={`invoice-card-${invoice.id}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <StatusIcon className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{invoice.invoiceNumber}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        {format(new Date(invoice.issueDate), "MMM d, yyyy")}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-semibold">{formatCurrency(invoice.totalAmount)}</p>
                      <Badge className={statusColors[invoice.status]} variant="secondary">
                        {invoice.status}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleViewInvoice(invoice)}
                        data-testid={`view-invoice-${invoice.id}`}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDownload(invoice)}
                        data-testid={`download-invoice-${invoice.id}`}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Invoice {selectedInvoice?.invoiceNumber}
            </DialogTitle>
          </DialogHeader>
          
          {isLoadingDetails ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : invoiceDetails ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Issue Date</p>
                  <p className="font-medium">{format(new Date(invoiceDetails.issueDate), "MMMM d, yyyy")}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Due Date</p>
                  <p className="font-medium">{format(new Date(invoiceDetails.dueDate), "MMMM d, yyyy")}</p>
                </div>
              </div>
              
              <Separator />
              
              <div>
                <p className="text-sm text-muted-foreground mb-2">From</p>
                <p className="font-medium">Tolstoy Staffing</p>
                <p className="text-sm text-muted-foreground">123 Market St, San Francisco, CA 94102</p>
                <p className="text-sm text-muted-foreground">billing@tolstoy.com</p>
              </div>
              
              <div>
                <p className="text-sm text-muted-foreground mb-2">To</p>
                <p className="font-medium">{invoiceDetails.company?.companyName || 'Company'}</p>
                <p className="text-sm text-muted-foreground">{invoiceDetails.company?.email}</p>
              </div>
              
              <Separator />
              
              <div>
                <p className="text-sm font-medium mb-2">Line Items</p>
                {invoiceDetails.items.map((item) => (
                  <div key={item.id} className="flex justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="text-sm">{item.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.quantity} hrs @ {formatCurrency(item.unitPrice)}/hr
                      </p>
                    </div>
                    <p className="font-medium">{formatCurrency(item.amount)}</p>
                  </div>
                ))}
              </div>
              
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>{formatCurrency(invoiceDetails.subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Platform Fee ($13/hr)</span>
                  <span>{formatCurrency(invoiceDetails.platformFee)}</span>
                </div>
                {invoiceDetails.taxAmount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Tax</span>
                    <span>{formatCurrency(invoiceDetails.taxAmount)}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span>{formatCurrency(invoiceDetails.totalAmount)}</span>
                </div>
              </div>
              
              {invoiceDetails.notes && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm">{invoiceDetails.notes}</p>
                </div>
              )}
              
              <div className="flex gap-2 pt-4">
                {invoiceDetails.status !== "paid" && (
                  <Button
                    onClick={() => markPaidMutation.mutate(invoiceDetails.id)}
                    disabled={markPaidMutation.isPending}
                    className="flex-1"
                    data-testid="mark-invoice-paid"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Mark as Paid
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => handleDownload(invoiceDetails)}
                  className="flex-1"
                  data-testid="download-invoice-btn"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              Unable to load invoice details
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
