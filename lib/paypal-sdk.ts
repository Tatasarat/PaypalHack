import {
  CheckoutPaymentIntent,
  Client,
  Environment,
  OrdersController,
} from '@paypal/paypal-server-sdk';

let controller: OrdersController | null = null;

// Created on first use, so a missing key fails with a clear message instead of at build time.
function orders(): OrdersController {
  if (!controller) {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('PayPal credentials are missing in the environment settings.');
    }

    controller = new OrdersController(
      new Client({
        clientCredentialsAuthCredentials: {
          oAuthClientId: clientId,
          oAuthClientSecret: clientSecret,
        },
        environment: Environment.Sandbox, // sandbox only, by design
      })
    );
  }
  return controller;
}

// Creates a PayPal order. The amount always comes from our database, never from the browser.
export async function createPayPalOrder(amountCents: number, description: string): Promise<string> {
  const { result } = await orders().createOrder({
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          amount: { currencyCode: 'USD', value: (amountCents / 100).toFixed(2) },
          description: description.slice(0, 120),
        },
      ],
    },
  });

  if (!result.id) throw new Error('PayPal did not return an order id.');
  return result.id;
}

// Approving an order does not move money. Capturing it does.
export async function capturePayPalOrder(orderId: string): Promise<{ status: string }> {
  const { result } = await orders().captureOrder({ id: orderId });
  return { status: String(result.status ?? 'UNKNOWN') };
}