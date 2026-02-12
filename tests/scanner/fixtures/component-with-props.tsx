function SearchBar() {
	return (
		<div>
			<input
				type="text"
				placeholder="Search for anything..."
				aria-label="Search input"
				className="search-input"
				name="query"
			/>
			<img src="/logo.png" alt="Company logo" title="Our company" />
			<a href="https://example.com">Visit our website</a>
		</div>
	);
}

export default SearchBar;
