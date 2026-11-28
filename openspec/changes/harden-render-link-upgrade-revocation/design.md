# Design: close authorization-to-admission race

The existing `createRenderLink()` adapter owns the WebSocket lifecycle around `JacoLinkRoom`. The room's HTTP upgrade request has already verified the ticket, but that verification is not sufficient after an intervening device revocation.

For host sockets, enqueue a durable `revoked:<deviceId>` lookup using the same account serializer that handles room fetches and WebSocket messages. Only after a successful negative lookup, while the socket remains open, close any superseded host connection and add the new host to the room's active socket set. Non-host sockets retain their existing admission behavior.

Incoming text messages are enqueued on the same account serializer and rejected if their WebSocket has not been admitted. Binary messages retain their existing rejection. Database errors close the pending socket, with no permissive fallback.

Regression cases simulate revocation after upgrade authorization, successful admission, and database failure. There is no new authentication authority, execution path, credential cache, or tool registry.
