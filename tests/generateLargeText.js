function generateLargeText(sizeInMb) {
	const sizeInBytes = sizeInMb * 1024 * 1024;
	const numberOfChars = Math.floor(sizeInBytes / 2); // JavaScript uses UTF-16 encoding, which uses 2 bytes per character
	let largeText = '';
	for (let i = 0; i < numberOfChars; i++) {
		largeText += 'a';
	}
	return largeText;
}

module.exports = generateLargeText;
