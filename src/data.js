const {getFollowers, getFriends, getMentions, getTimeline, getLiked, getAvatars} = require("./api");

/**
 * A small function that records an interaction.
 * If a user already exists in the interactions object, increment the count for the specific type.
 * Otherwise create a new object for the user and set the type for this interaction to 1
 *
 * @param interactions our array to which to add the record
 * @param screen_name
 * @param user_id
 * @param type 'reply' | 'retweet' | 'like'
 */
function addRecord(interactions, screen_name, user_id, type) {
	if (user_id in interactions) interactions[user_id][type] += 1;
	else
		interactions[user_id] = {
			screen_name,
			id: user_id,
			reply: 0,
			retweet: 0,
			like: 0,
			mention: 0,
			[type]: 1,
		};
}

/**
 * Loop over the timeline posts and record the ones where they are a reply to someone
 * To know if it's a reply the in_reply_to_user_id_str property will not be null.
 * We also need to make sure that in_reply_to_screen_name is different from our own screen_name to avoid adding ourselves
 * @param interactions
 * @param timeline
 * @param screen_name
 */
function countReplies(interactions, timeline, screen_name) {
	for (const post of timeline) {
		if (
			!!post.in_reply_to_user_id_str &&
			post.in_reply_to_screen_name.toLowerCase() !== screen_name &&
			globalThis.followers.includes(post.in_reply_to_user_id_str)
		) {
			addRecord(
				interactions,
				post.in_reply_to_screen_name,
				post.in_reply_to_user_id_str,
				"reply"
			);
		}
	}
}

/**
 * Loop over the timeline posts and record the ones where they are a retweet to someone else's posts
 * To know if it's a retweet the retweeted_status property will not be null.
 * We also need to make sure that retweeted_status.user.screen_name is different from our own screen_name to avoid adding ourselves
 * @param interactions
 * @param timeline
 * @param screen_name
 */
function countRetweets(interactions, timeline, screen_name) {
	for (const post of timeline) {
		if (
			post.retweeted_status &&
			post.retweeted_status.user &&
			post.retweeted_status.user.screen_name.toLowerCase() !== screen_name &&
			globalThis.followers.includes(post.retweeted_status.user.id_str)
		) {
			addRecord(
				interactions,
				post.retweeted_status.user.screen_name,
				post.retweeted_status.user.id_str,
				"retweet"
			);
		}
	}
}

/**
 * Loop over the liked posts and record the all the ones that are not ours.
 * @param interactions
 * @param likes
 * @param screen_name
 */
function countLikes(interactions, likes, screen_name) {
	for (const post of likes) {
		if (post.user.screen_name.toLowerCase() !== screen_name &&
		globalThis.followers.includes(post.user.id_str)) {
			addRecord(
				interactions,
				post.user.screen_name,
				post.user.id_str,
				"like"
			);
		}
	}
}

/**
 * Loop over the mentions and record the all the ones that are not ours.
 * @param interactions
 * @param mentions
 * @param screen_name
 */
function countMentions(interactions, mentions, screen_name) {
	for (const post of mentions) {
		if (post.user.screen_name.toLowerCase() !== screen_name &&
		globalThis.followers.includes(post.user.id_str)) {
			addRecord(
				interactions,
				post.user.screen_name,
				post.user.id_str,
				"mention"
			);
		}
	}
}

module.exports = async function getInteractions(screen_name, layers) {
	globalThis.followers = await getFollowers(screen_name);
	globalThis.friends = await getFriends(screen_name);
	const mentions = await getMentions(screen_name);
	const timeline = await getTimeline(screen_name);
	const liked = await getLiked(screen_name);

	/**
	 * This is the main place where we are going to keep our data as we process it.
	 * It's an object where the key is the user_id and the values is an object like this:
	 * {
	 *		screen_name: string,
	 *		id: string,
	 *		reply: number,
	 *		retweet: number,
	 *		like: number,
	 *      mention: number,
	 * }
	 */
	const interactions = {};

	countMentions(interactions, mentions, screen_name);
	countReplies(interactions, timeline, screen_name);
	countRetweets(interactions, timeline, screen_name);
	countLikes(interactions, liked, screen_name);

	const tally = [];

	/**
	 * This is the heart of the algorithm.
	 * We process all the collected interactions and assign a value to them and count the total.
	 * We stored the processed interactions in our `tally` array.
	 * Each object in our tally array looks like this:
	 * {
	 *		screen_name: string,
	 *		id: string,
	 *		total: number
	 * }
	 */
	for (const [key, interaction] of Object.entries(interactions)) {
		let total = 0;
		total += interaction.like * 0.5;
		total += interaction.reply * 1;
		total += interaction.retweet * 1.5;
		total += interaction.mention * 2;

		tally.push({
			id: interaction.id,
			screen_name: interaction.screen_name,
			total,
		});
	}

	// sort the tally array by total descending
	tally.sort((a, b) => b.total - a.total);

	// Total sum of needed users, it's like layer[0]+layer[1]+layer[2]
	const maxCount = layers.reduce((total, current) => total + current, 0);

	// take only the top part of the array between 0 and the total needed
	const head = tally.slice(0, maxCount);

	// fetch the avatars for these users.
	// The API allows only 100 users on this call.
	// Pagination could be added to support more but the image would get super busy
	const ids = head.map((u) => u.id);
	const avatars = await getAvatars(ids);
	for (const i of head) {
		i.avatar = avatars[i.id];
	}

	// split the head back into layers
	const result = [];
	result.push(head.splice(0, layers[0]));
	result.push(head.splice(0, layers[1]));
	result.push(head.splice(0, layers[2]));

	return result;
};
