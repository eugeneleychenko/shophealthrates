# Lindsy

**Meeting Date:** 20th Aug, 2026 - 2:33 PM

---

**Lindsy Mueller** *[00:00]*: Yeah, it's just like everybody hears from somewhere else. So that's why I always ask like everybody always comes down from somewhere and nobody here actually lives here or lived here again growing up. 
**Mikhail Andreyev** *[00:10]*: So. 
**Lindsy Mueller** *[00:11]*: Yeah. Very cool. That's fun that you come down all the time or used to, I should say. Yeah. 
**Eugene** *[00:18]*: Last time we stayed in Coloni and the time before that were in Palmetto Dunes where the office is located. 
**Lindsy Mueller** *[00:27]*: The offices, our Queen street offices are all the way out in Foster City near San Francisco. Oh yeah. So we're all for the most part, we're all remote. They consolidated us during COVID like everybody's remote. A whole bunch of people left the Bay Area and I was already here luckily, so I didn't have to. But. But guys, I think so we have some questions on the clicks. Is that kind of what I'm thinking? 
**Eugene** *[00:56]*: Yeah, so I was trying to get. Because I'm responsible for implementing this on the Shop Health threats site. 
**Lindsy Mueller** *[01:03]*: Okay. 
**Eugene** *[01:04]*: So we created. Or Misha created. What was that URL? It was shophealthrates.com. Let me look through the. 
**Mikhail Andreyev** *[01:19]*: Lindsy hasn't seen that one yet. Let me. 
**Eugene** *[01:21]*: Okay, but my question would be. And basically he created a in contact form, quick quote HTML. I'll share that right now. 
**Lindsy Mueller** *[01:32]*: Okay. 
**Eugene** *[01:34]*: Okay. L L. Okay cool. So I'm going to share that. So it looks a little bit like this. 
**Lindsy Mueller** *[01:47]*: Okay. 
**Eugene** *[01:48]*: My assumption is that when someone clicks off of Insure.com on a LEO source ad, their information will be pre populated here. Is that right? 
**Lindsy Mueller** *[02:00]*: Yeah. As long as we set up. If you guys could send me any API specs that you have where we can feed these fields with the data. 
**Eugene** *[02:09]*: Thinking the other way around. So that's funny that you're saying that because I was expecting to parse your. Whatever the link would be to LEO source and I assume I would be getting. You know it'd be some params in the URL. 
**Lindsy Mueller** *[02:28]*: We'll have. Let's see. So essentially the user can. The whole entire flow would be on the off of a click wall is if they didn't just come in directly from like an ad and come directly to the ad that we wouldn't have anything to pre fill. But if they came in off of somebody else's form and then. Or our form we'll say we'll just use insure.com, they fill out our lead form. They see a thank you page which has LEO sources ad on it and then they click. What we would do is take their information that they filled into our form or any other form it passes through our service called Next Insure and then populates over to you. 
**Eugene** *[03:12]*: So my question. Yeah, so my question is, I would love to see what that link looks like when they're being transported. I assume all the information that's relevant for the contact form would be somehow in that link, is that right? How does that information get transferred? 
**Lindsy Mueller** *[03:36]*: Well, if we set up the API, it'll ping the API and then pass over the pii because we can't send first name, last name, data of birth and stuff like that. In the URL. 
**Eugene** *[03:45]*: In the URL. So you need it. Okay, so you are looking for us to create some sort of postable API endpoint that you can send that information through, is that correct? 
**Lindsy Mueller** *[03:59]*: Yes, you got it. 
**Eugene** *[04:03]*: That's not difficult. So, and to confirm you're still seeing my screen, it would be just for these fields or is there some other hidden field that you guys want to post to? 
**Lindsy Mueller** *[04:15]*: No, no, just for those fields is fine. We can add other things in the URL that are not PI sensitive. Like we could add source, we can add sub id so you can see exactly like we'll send you a, a sub ID and then I can show you in QMP where you would match those things together if you wanted to. See, it's just the PII information that we can't pass parameters. 
**Eugene** *[04:40]*: Yeah, I hear you. 
**Lindsy Mueller** *[04:43]*: Yeah. And then the thing is, for the most part, if we have the information, we'll send it. I will say, I think there's a couple of publishers that don't store all of that information all the way through. So there might be some of it, but not all of it. And that's just. We've been working with those guys for a while to get everything, but they just don't do it. 
**Eugene** *[05:02]*: So, so like just since I have you on the phone. 
**Lindsy Mueller** *[05:06]*: Yeah. 
**Eugene** *[05:06]*: First, last phone address, email question for you. Address. Are you guys passing that as just one long string or are you breaking that up into states, cities, zips? 
**Lindsy Mueller** *[05:21]*: Let's see. I think actually you can tell us how you want it formatted and broken out. 
**Eugene** *[05:30]*: This is okay with you? You don't need to have it broken up into those fields? 
**Lindsy Mueller** *[05:35]*: I don't think so. No, I think we should be okay. 
**Eugene** *[05:37]*: Okay. 
**Mikhail Andreyev** *[05:39]*: So Lindsy, while the website is up, my. I saw the average premium for the one. I saw the competitors, right. They just have their usual lander, whereas zip code, gender and it's, you know, switches them from page to page. But we have as well. But I Figured because it's a pre fill to drop it all one site, one shot. So could they just have one button to hit essentially to kind of simplify the process? 
**Lindsy Mueller** *[06:21]*: I think that makes a lot of sense, especially with the pre fill. And this will be really helpful in season. That's great. That's obviously like super great. Makes it really easy out of season. The short form is. Actually tends to perform better than the long forms too, because if you think about it, they're kind of in the market, but they're not, you know, like, they're still shopping. So. Yeah, I like this fact that you went with this shorter form here. One thing you might want to do on here, even though you have street address, you guys might want to. Just for the people that even were not sending your way, because we'll do an address validation on our form so you know that the address coming through is correct. Do you guys have address and phone number validation or email validation? 
**Eugene** *[07:07]*: Yeah. 
**Lindsy Mueller** *[07:08]*: Cool. 
**Eugene** *[07:08]*: We have address validation. So if I were to 1600 pencil there it is like this. 
**Lindsy Mueller** *[07:15]*: Yeah, yeah. So exactly. So somebody can't just type in the wrong stuff and send you a fake lead. You know what I mean? Like, we don't. 
**Eugene** *[07:21]*: Right. 
**Lindsy Mueller** *[07:22]*: We want. Yeah. So, yeah. 
**Eugene** *[07:24]*: Phone number validation. I mean, at a very high level, I believe. Like, let's see that. That's still not good. Well, hold on. Let's refresh the page. I would have been. Yeah, well, I need to confirm that. 
**Lindsy Mueller** *[07:42]*: Yeah, yeah. And not everybody has phone number validation. It's just an extra step if you're. 
**Eugene** *[07:49]*: You're just talking about that. It has 10 digits. Not if it actually exists. 
**Lindsy Mueller** *[07:54]*: Actually, actually. To see if it actually exists. Yeah. 
**Eugene** *[07:57]*: What service do you guys use for that? Or do people use for that? 
**Lindsy Mueller** *[08:00]*: No, I don't know, but I can find out for you guys. 
**Eugene** *[08:03]*: That would be. That'd be helpful, right? 
**Lindsy Mueller** *[08:05]*: Shoot. Lisa. 
**Mikhail Andreyev** *[08:06]*: Yeah, yeah. Actually looking at them. Yeah,. 
**Eugene** *[08:12]*: I would. 
**Mikhail Andreyev** *[08:13]*: Period. 
**Eugene** *[08:14]*: Alex. 
**Mikhail Andreyev** *[08:16]*: Okay. 
**Eugene** *[08:18]*: I was gonna say that there's levels to it. Like, some don't accept voip. Like, sometimes I put it in. 
**Mikhail Andreyev** *[08:27]*: That's what we actually need is to remove voip. 
**Eugene** *[08:32]*: Yeah. Because I use like Google, they're like, no, no, thanks. 
**Lindsy Mueller** *[08:39]*: That's not. That's not cool. I have a Google voice number too. That's not fun. Like, okay, let use that. 
**Eugene** *[08:45]*: I mean, there are ways. There are other services that are not yet on the. There's like here, I'll share some alpha with you guys. There's something called. I think I was talking to you about this. Mish Talkatone. 
**Lindsy Mueller** *[08:56]*: Interesting. 
**Eugene** *[08:57]*: It's like one of those burner phone number. 
**Mikhail Andreyev** *[08:59]*: Oh, yes. 
**Eugene** *[09:00]*: Yeah. 
**Lindsy Mueller** *[09:01]*: Oh, wow. 
**Eugene** *[09:02]*: Really good stuff. Really good stuff. 
**Mikhail Andreyev** *[09:04]*: Yeah. 
**Eugene** *[09:05]*: Basically like Google voice, but yeah, good to know. 
**Lindsy Mueller** *[09:09]*: Okay, Yeah, I shot our head of product to shot the question to see if she's got the answer for us, but looks like she's on a call right now, so. Yeah, I'll put that into Slack when I get that. 
**Eugene** *[09:21]*: Okay, so we got date of birth. Is there any sort of validation you guys do? Sorry about that. Are you. Is there any validation that you guys are doing on your own side so we don't need to do it? 
**Lindsy Mueller** *[09:36]*: I mean, it probably won't matter. Like, I'm just more thinking about when you're getting people in your form not coming from us, you know, where we haven't already validated or I can't speak for the publishers who maybe only do email validation but don't have phone validation. Most of the big guys have this in place, but I honestly don't know this list. And if we get some pubs that are coming in right ahead of this season, some of these guys might do email address validation, but maybe they don't do phone number validation. They all do address. So. 
**Eugene** *[10:12]*: Yeah. And to confirm, when you say validation, you're talking about something more sophisticated than just simple regex validation. 
**Lindsy Mueller** *[10:18]*: Right, Right. Like, address is real and phone number is actually real. Email is actually real exist. 
**Eugene** *[10:25]*: Okay, got it. Okay. Yeah, so that's what I'm saying. Like, I. I don't want to overcook this turkey. If you're already doing it, then we don't need to spend money on experience. 
**Mikhail Andreyev** *[10:35]*: Yeah, yeah. For our mainlander, it probably makes sense to cut out the void. And I'm gonna look into that. I'm gonna dig into that. And yeah, I think household income. How does that comes in? Come in? Because this has ranges. 
**Lindsy Mueller** *[10:54]*: Okay. What. So depending on the vendor, like for Quinn street, if. If we have a range of like, say it's 30,000 to 39,999, we would pass over the top end of our range. So 39, 9.99 would come through to you guys. Other publishers, other. Other. Other websites have text input that will come over that way. Others, if they have a button they'll click like up to or over. That one's going to be really different depending on the source of where the leads are coming from, just because there's not a standard way. 
**Eugene** *[11:34]*: So it seems like if Misha, if this, if R, slash quick quote is only for this integration that it seems like every single field should be. I would hate to. I'm just thinking about this because, like, based on what Lindsay's saying here, if I'm understanding correctly, there might be different ranges and I would hate to get any of these fields get rejected because. Yeah, so that's why I'm asking. 
**Mikhail Andreyev** *[12:12]*: Wendy. We should leave it, not. Can you click on it? 
**Lindsy Mueller** *[12:16]*: Yeah, I was gonna say, because we're gonna have. On our side for your guys's campaign, we're gonna be filtering for income. Right. I think. 
**Mikhail Andreyev** *[12:24]*: Yes. Correct. 
**Lindsy Mueller** *[12:25]*: Yeah. 
**Mikhail Andreyev** *[12:26]*: Yes. 
**Lindsy Mueller** *[12:26]*: So we shouldn't be sending you system wide anybody that isn't already qualified on the income side. Yeah, but we still. 
**Mikhail Andreyev** *[12:36]*: Yeah, but we still want our agents to see the income. 
**Lindsy Mueller** *[12:39]*: Yeah, no, that makes sense. Good point, good point. 
**Mikhail Andreyev** *[12:41]*: Yeah. So we should probably just change it to text. What do you think, Eugene? 
**Eugene** *[12:47]*: Yes, we should change it to. It accepts text, but then it also does this. So it's like both. You can put in text or you can just choose like this, but it'll always accept text. 
**Mikhail Andreyev** *[12:59]*: Okay. 
**Eugene** *[12:59]*: Yeah, so same thing with date of birth, it'll accept text because, I don't know, some people write Jan, not January. Yeah, this one also. It might sometimes come over as two digits. I don't know. I'm just thinking of every long tail thing that can go wrong. 
**Lindsy Mueller** *[13:19]*: Yeah, well, and you can in. In what? We pass you for the pre fill side. I mean, we'll. We'll standardize it to whatever you guys want it to be. But to your point, like if somebody just comes in here randomly, starts typing, then, you know, we can't change that. But. 
**Eugene** *[13:36]*: Okay, so that. So just so I can give back 13 minutes, I just need to give you guys an API that is postable to fill out these fields, plus possibly source. Is that the hidden field that you were talking about? 
**Lindsy Mueller** *[13:54]*: Yeah. So essentially the API, well, the API would be separate from the click through URL. I can. I can append the click through URL and I'll send you a list. I'll put it in Slack, I can send you a list of parameters that we can pass in the URL. So that way you can see. Okay, well, this is what they'll pass through in the API. This is what I can get from the URL. And then you guys can run with. 
**Mikhail Andreyev** *[14:15]*: It from there and then sub ID as well. Is that correct? 
**Lindsy Mueller** *[14:19]*: Yeah, that can come through in the URL. So that'll come through and you'll be able to see it. 
**Eugene** *[14:25]*: And Misha, where are you capturing this is going straight into Barbado. 
**Mikhail Andreyev** *[14:29]*: So we're capturing it in Bobberdu. I'm just thinking, is clickflare a part of it? Because I know Josh loves clickflare and it's. This thing is there. 
**Eugene** *[14:46]*: I thought it was just to measure paid. Just to measure search. Paid search. 
**Mikhail Andreyev** *[14:55]*: That's what I thought. So, yeah. So I don't think clickflare is relevant here then. So, Lindsy, how do we report sales back to you or conversions? What kind of reporting? What do you want? Sales or conversions? 
**Lindsy Mueller** *[15:14]*: What KPI do you. We can do both. So I can pass through to you guys. I can send through what I call a click key, and that'll be a parameter that'll be included in the URL. So, Eugene, I'd ask you for like a UTM you wanted me to apply, like use that with. But basically what happens, the user clicks, it hits our sure hit slash next insure, generates that click key and then sends them over to you guys. So now we're watching what they're doing from there. If you guys can store that click key and then pass it back to us, that would be the best. And sorry, there's. There's sawing stuff outside. I don't know if you guys hear this, but trying to spit a bane of my existence today. 
**Mikhail Andreyev** *[16:00]*: Can we. Can we put the click key in the sub ID section in there? Bobberdoo. Is that okay? 
**Lindsy Mueller** *[16:09]*: I. I have clients who do pull and store that into Bobberdoo. I don't know how they do it,. 
**Mikhail Andreyev** *[16:15]*: But I mean, I guess I just need to add another. Yeah, I need to add another field into Barberdo. 
**Lindsy Mueller** *[16:23]*: Yeah. 
**Eugene** *[16:24]*: Oh, here's an interesting question for Lindsy. For the clients that don't have Bobberdew, what are they using as a substitute to Bobberdoo? 
**Lindsy Mueller** *[16:35]*: There are a lot of. 
**Mikhail Andreyev** *[16:39]*: In the track drive. 
**Lindsy Mueller** *[16:40]*: Custom. What's that? 
**Mikhail Andreyev** *[16:42]*: Track drive or no track drive? 
**Lindsy Mueller** *[16:45]*: I don't know that I've heard of that track. I'm trying to think. I don't want to get them mixed up between like the caller, the call stuff and the Qlik stuff. So I'm trying to think of what the integrations that we've done because I don't know if Convoso takes in Qlik data, Wikipedia or there's a couple of different ones that I see often. Ringba is more for calls. Yeah, some people are just taking stuff and I think there's one. One client who just pulls things into like Amazon Web Services and this built their own little dashboard to like Pull. I don't know. I think that's a little beyond me, I have to say. 
**Eugene** *[17:25]*: No, just anecdotally. 
**Lindsy Mueller** *[17:27]*: Yeah, I don't. I mean, I just. I feel like it's different. Just depends on what everybody needs. But I can find out like what people use most. If you want me to ask my team, I can definitely do that because I just, honestly, I don't really know on the qlik side of things what the number one is that everybody's using. And then sometimes people are just throwing stuff straight into CRMs, storing things that way. So. 
**Mikhail Andreyev** *[17:55]*: Yeah, I think it's. I think it's Leadspedia. I'm looking at it. 
**Lindsy Mueller** *[17:58]*: Leadspedia. 
**Mikhail Andreyev** *[18:00]*: Yeah, that's their. 
**Lindsy Mueller** *[18:05]*: That their CRM then. 
**Mikhail Andreyev** *[18:08]*: Yeah, they do clicks and calls. It's just the reason why we ask. Lead Prosper. Yeah, I think I know that. 
**Lindsy Mueller** *[18:23]*: PDA leaves Prosper. What else? Try to see the ones that I. Yeah, ctm. What's that? Need bite. Interesting. There's a whole bunch out here, apparently. But let me know, guys. 
**Mikhail Andreyev** *[18:50]*: Okay. 
**Eugene** *[18:51]*: Okay. 
**Mikhail Andreyev** *[18:51]*: Anyhow, not a problem. 
**Eugene** *[18:53]*: So how am I. Am I over email conveying those that endpoints to you? 
**Lindsy Mueller** *[19:01]*: You can, you can send it over an email if you like. If you put in a document or whatever, we can do that over email, that's totally fine. And I'll send you the spreadsheet then over email. That way it's easy to just go back to it. It's not works for you. Unless you like Slack better. I am. 
**Eugene** *[19:16]*: Oh, that's right, I forgot about Slack. Yeah, Amnesia. 
**Mikhail Andreyev** *[19:23]*: And then. 
**Eugene** *[19:26]*: Okay, cool. I think I got what I wanted. Yeah, I'll send it over and if you have some feedback, I'll make those changes. 
**Lindsy Mueller** *[19:35]*: Right. And then I'll send you the macros that we can pass. And then feel free to build that URL however big and long you want based on what additional data you want to be able to pull back and store on your side. Like I said, all we really need to store is the click key. See the date of the conversion, the click key. And then like if you had a quote, we can do a one or zero, you know it's true, false. However you guys want to map it, that's fine. And then obviously if it's a sale, true or false. And we can also ingest revenue, like if you have a policy revenue on that. Because what that allows us to do is then optimize towards the sources that are producing the higher policy sales. Like we did that for E Health, for example. 
**Mikhail Andreyev** *[20:19]*: Yes, yeah, we would like that. 
**Lindsy Mueller** *[20:22]*: Yeah, I can. 
**Mikhail Andreyev** *[20:23]*: Probably. 
**Lindsy Mueller** *[20:24]*: Especially during the season. That's a big one. 
**Mikhail Andreyev** *[20:27]*: Yeah. And how do you want that done? 
**Lindsy Mueller** *[20:31]*: I mean, if you guys have a field or if you store that somewhere and just a downloadable CSV file is totally fine. You can email it to me once a day, once a week. However. However often you want to send over that data is not totally fine. 
**Mikhail Andreyev** *[20:48]*: Because ad spend IQ registers revenue. So I can just pull it from there. 
**Lindsy Mueller** *[20:56]*: That's nice. 
**Mikhail Andreyev** *[20:57]*: So we have a place where we get revenue. 
**Lindsy Mueller** *[21:00]*: Okay. I love that. 
**Mikhail Andreyev** *[21:03]*: And I created it. 
**Lindsy Mueller** *[21:05]*: You did? 
**Mikhail Andreyev** *[21:06]*: Yeah, I did. 
**Lindsy Mueller** *[21:09]*: Very cool. Can you add a field in there to take in? No, because you'd have to marry those two together. And there. I can add. 
**Mikhail Andreyev** *[21:19]*: I can add anything. It's just. But it gets his data from Convoso, which gets its data from Barbado. 
**Lindsy Mueller** *[21:26]*: Okay. So we would have to go to Babadoo and find that click key and pull it out so that you could send one report with. 
**Mikhail Andreyev** *[21:33]*: Yeah, yeah, we have a shield sub. 
**Lindsy Mueller** *[21:36]*: ID that you will get in the URL. I can send that because that'll. That'll tell you what the source is. 
**Mikhail Andreyev** *[21:43]*: Okay, so. So we need sub id. So we need another. 
**Eugene** *[21:48]*: We need another field. 
**Lindsy Mueller** *[21:50]*: Yeah, yeah, got it. Because I do want to send you that source in the URL. That'll be. That'll be helpful for you guys if you're like, oh, my God, check out this one source. It's got, like, a $5,000 CPA. Hopefully not, but, you know, we'll be like, yeah, we're going to shut that down. 
**Mikhail Andreyev** *[22:06]*: Yep, got it. Understood. 
**Eugene** *[22:10]*: Okay, sounds great. 
**Lindsy Mueller** *[22:13]*: Real quick, not to confuse you guys more if it's easier, while you guys are working on, like, how you figure out how we can, like, ingest and store that click key and whatnot. Get that stuff back to us. One thing we can do is I could pass you pixels and I could pass you a pixel that fires on a quote event. Say somebody just clicks the form to submit. That could be a quote event. I don't know where we would pass something on a sale. I still think that would have to come back, like, in some sort of. 
**Mikhail Andreyev** *[22:43]*: That would come from us. 
**Lindsy Mueller** *[22:44]*: Yeah, yeah. So. But that's an option if that helps you guys in, like, phasing the approach or implementing any of this. So. 
**Mikhail Andreyev** *[23:01]*: Okay. 
**Lindsy Mueller** *[23:04]*: It's probably clear as mud, isn't it? I'm sorry. 
**Eugene** *[23:06]*: That's good. It's good. We'll get it done in record time. 
**Lindsy Mueller** *[23:11]*: All right. Awesome, awesome. All right, guys. Well, shoot me over any other questions, I'll pull together that macro list and keep on keeping on. 
**Eugene** *[23:23]*: Awesome. Really nice meeting you. 
**Lindsy Mueller** *[23:25]*: Nice meeting you, too. Sorry you couldn't make it this Labor Day. It's really hot. Don't worry. It's really hot. You might not even be outside, it's so hot. 
**Eugene** *[23:38]*: Well, I'm actually flying to Florida on Monday, so it's going to be hotter. 
**Lindsy Mueller** *[23:42]*: Oh, true. Okay. Yeah. Well, safe travels then. 
**Eugene** *[23:46]*: Okay, bye now. 
**Lindsy Mueller** *[23:47]*: All right, Bye, you guys. 
**Mikhail Andreyev** *[23:48]*: Okay, bye. 
