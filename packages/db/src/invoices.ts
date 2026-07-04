/**
 * @restropulse/db - Invoices
 * CRUD helpers for the invoices collection.
 */

import { getInvoicesCollection, toApiFormat, toApiFormatArray, toObjectId } from './connection.js';

export async function createInvoice(invoice: Record<string, unknown>) {
    const now = new Date();
    const result = await getInvoicesCollection().insertOne({
        ...invoice,
        createdAt: now,
        updatedAt: now,
    });
    return { id: result.insertedId.toString(), ...invoice };
}

export async function findInvoicesByRestaurant(restaurantId: string, limit = 50) {
    const docs = await getInvoicesCollection()
        .find({ restaurantId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
    return toApiFormatArray(docs);
}

export async function findInvoiceById(id: string) {
    const doc = await getInvoicesCollection().findOne({ _id: toObjectId(id) as any });
    return toApiFormat(doc);
}

export async function findInvoiceByRazorpayId(razorpayInvoiceId: string) {
    const doc = await getInvoicesCollection().findOne({ razorpayInvoiceId });
    return toApiFormat(doc);
}

export async function findInvoiceByPaymentId(razorpayPaymentId: string) {
    const doc = await getInvoicesCollection().findOne({ razorpayPaymentId });
    return toApiFormat(doc);
}

export async function findInvoicesByRazorpaySubscriptionId(razorpaySubscriptionId: string) {
    const docs = await getInvoicesCollection()
        .find({ razorpaySubscriptionId })
        .toArray();
    return toApiFormatArray(docs);
}

export async function updateInvoice(id: string, updates: Record<string, unknown>) {
    await getInvoicesCollection().updateOne(
        { _id: toObjectId(id) as any },
        { $set: { ...updates, updatedAt: new Date() } },
    );
}
