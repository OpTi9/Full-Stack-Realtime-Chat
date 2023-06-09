import {addFriendValidator} from "@/lib/validations/add-friend";
import {getServerSession} from "next-auth";
import {authOptions} from "@/lib/auth";
import {fetchRedis} from "@/helpers/redis";
import {db} from "@/lib/db";
import {z} from "zod";
import {pusherServer} from "@/lib/pusher";
import {toPusherKey} from "@/lib/utils";

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const {email: emailToAdd} = addFriendValidator.parse(body.email);

        const idToAdd = await fetchRedis('get', `user:email:${emailToAdd}`) as string;

        // if it doesn't exist, return 400
        if (!idToAdd) {
            return new Response('User not found', {status: 400});
        }

        // find out who asked
        const session = await getServerSession(authOptions);
        if (!session) {
            return new Response('Unauthorized', {status: 401});
        }

        // don't let add self
        if (idToAdd === session.user.id) {
            return new Response('Cannot add self', {status: 400});
        }

        // don't let add if already added request to be friends
        const isAlreadyAdded = await fetchRedis('sismember', `user:${idToAdd}:incoming_friend_requests`, session.user.id) as 0 | 1;
        if (isAlreadyAdded) {
            return new Response('Already added this user', {status: 400});
        }

        // check if already friends
        const isAlreadyFriends = await fetchRedis('sismember', `user:${session.user.id}:friends`, idToAdd) as 0 | 1;
        if (isAlreadyFriends) {
            return new Response('This user is already in your friendlist', {status: 400});
        }

        // using pusher to send friend request
        await pusherServer.trigger(toPusherKey(`user:${idToAdd}:incoming_friend_requests`), 'incoming_friend_requests', {
            senderId: session.user.id,
            senderEmail: session.user.email,
        });

        // valid request, proceed
        await db.sadd(`user:${idToAdd}:incoming_friend_requests`, session.user.id);
        return new Response('Friend request sent', {status: 200});

    } catch (error) {
        if (error instanceof z.ZodError) {
            return new Response('Invalid request payload', {status: 422});
        }
        return new Response('Invalid request', {status:400});
    }
}