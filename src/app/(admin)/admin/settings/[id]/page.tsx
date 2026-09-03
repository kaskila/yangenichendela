import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { getMerchantNumber } from "@/lib/services/store";
import { MerchantNumberForm } from "../merchant-number-form";

export default async function EditMerchantNumberPage({
  params,
}: PageProps<"/admin/settings/[id]">) {
  await requireAdmin();
  const { id } = await params;

  const merchantNumber = await getMerchantNumber(id);
  if (!merchantNumber) notFound();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="truncate text-lg font-semibold tabular">
          {merchantNumber.number}
        </h1>
        <Link href="/admin/settings" className="shrink-0 text-sm underline">
          Back to settings
        </Link>
      </div>
      <MerchantNumberForm merchantNumber={merchantNumber} />
    </div>
  );
}
